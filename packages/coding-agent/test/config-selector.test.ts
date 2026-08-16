import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager, type ScopedResolvedPaths } from "../src/core/package-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { ConfigSelectorComponent } from "../src/modes/interactive/components/config-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderPlain(component: ConfigSelectorComponent, width = 120): string {
	return stripAnsi(component.render(width).join("\n"));
}

describe("ConfigSelectorComponent", () => {
	let projectDir: string;
	let agentDir: string;
	let settingsManager: SettingsManager;
	let onClose: () => void;
	let previousHome: string | undefined;

	async function createComponent(): Promise<ConfigSelectorComponent> {
		const packageManager = new DefaultPackageManager({
			cwd: projectDir,
			agentDir,
			settingsManager,
			bundledSkillsDir: null,
		});
		const resolvedPaths: ScopedResolvedPaths = await packageManager.resolveScoped();
		return new ConfigSelectorComponent(
			resolvedPaths,
			settingsManager,
			projectDir,
			agentDir,
			onClose,
			() => {},
			() => {},
		);
	}

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		previousHome = process.env.HOME;
		// Keep auto-discovery away from the real ~/.agents/skills
		projectDir = join(tmpdir(), `config-selector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		process.env.HOME = projectDir;
		agentDir = join(projectDir, "agent");
		const userSkillsDir = join(agentDir, "skills", "foo");
		const projectSkillsDir = join(projectDir, ".prime", "agent", "skills", "bar");
		mkdirSync(userSkillsDir, { recursive: true });
		mkdirSync(projectSkillsDir, { recursive: true });
		writeFileSync(join(userSkillsDir, "SKILL.md"), "# Foo");
		writeFileSync(join(projectSkillsDir, "SKILL.md"), "# Bar");

		settingsManager = SettingsManager.create(projectDir, agentDir);
		onClose = vi.fn();
	});

	afterEach(() => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("global pane shows only user-scope resources", async () => {
		const component = await createComponent();
		const rendered = renderPlain(component);

		expect(rendered).toContain("Global Resources");
		expect(rendered).toContain("foo");
		expect(rendered).not.toContain("bar");
	});

	it("Tab switches between global and project panes", async () => {
		const component = await createComponent();
		const list = component.getResourceList();

		list.handleInput("\t");
		const projectRendered = renderPlain(component);
		expect(projectRendered).toContain("Project Local Resources");
		expect(projectRendered).toContain("bar");
		expect(projectRendered).not.toContain("foo");

		list.handleInput("\t");
		const globalRendered = renderPlain(component);
		expect(globalRendered).toContain("Global Resources");
		expect(globalRendered).toContain("foo");
		expect(globalRendered).not.toContain("bar");
	});

	it("toggling in the global pane writes only the global settings file", async () => {
		const component = await createComponent();
		const globalSettingsPath = join(agentDir, "settings.json");
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");

		component.getResourceList().handleInput(" ");
		await settingsManager.flush();

		expect(existsSync(globalSettingsPath)).toBe(true);
		const globalSettings = JSON.parse(readFileSync(globalSettingsPath, "utf-8"));
		expect(globalSettings.skills).toEqual(["-skills/foo/SKILL.md"]);
		expect(existsSync(projectSettingsPath)).toBe(false);
	});

	it("toggling in the project pane writes only the project settings file", async () => {
		const component = await createComponent();
		const globalSettingsPath = join(agentDir, "settings.json");
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");

		component.getResourceList().handleInput("\t");
		component.getResourceList().handleInput(" ");
		await settingsManager.flush();

		expect(existsSync(projectSettingsPath)).toBe(true);
		const projectSettings = JSON.parse(readFileSync(projectSettingsPath, "utf-8"));
		expect(projectSettings.skills).toEqual(["-skills/bar/SKILL.md"]);
		expect(existsSync(globalSettingsPath)).toBe(false);
	});
});
