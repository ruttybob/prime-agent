import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultPackageManager, type ScopedResolvedPaths } from "../src/core/package-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { ConfigSelectorComponent } from "../src/modes/interactive/components/config-selector.js";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.js";

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
		expect(projectRendered).toContain("foo");

		list.handleInput("\t");
		const globalRendered = renderPlain(component);
		expect(globalRendered).toContain("Global Resources");
		expect(globalRendered).toContain("foo");
		expect(globalRendered).not.toContain("bar");
	});

	it("shows inherited-global resources dimmed with their inherited state", async () => {
		const component = await createComponent();
		component.getResourceList().handleInput("\t");

		const rawLines = component.render(120);
		const fooLine = rawLines.find((line) => stripAnsi(line).includes("foo"))!;
		const plain = stripAnsi(fooLine);
		expect(plain).toContain("[x]");
		expect(plain).toContain("inherited global");
		const dimmedText = theme.fg("dim", "probe");
		const dimEscape = dimmedText.slice(0, dimmedText.indexOf("probe"));
		expect(fooLine).toContain(dimEscape);
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

	it("toggling a project resource in the project pane writes only the project settings file", async () => {
		const component = await createComponent();
		const globalSettingsPath = join(agentDir, "settings.json");
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");

		component.getResourceList().handleInput("\t");
		// First item is the inherited user skill; move down to the project skill.
		component.getResourceList().handleInput("\x1b[B");
		component.getResourceList().handleInput(" ");
		await settingsManager.flush();

		expect(existsSync(projectSettingsPath)).toBe(true);
		const projectSettings = JSON.parse(readFileSync(projectSettingsPath, "utf-8"));
		expect(projectSettings.skills).toEqual(["-skills/bar/SKILL.md"]);
		expect(existsSync(globalSettingsPath)).toBe(false);
	});

	it("undims an inherited-global resource once overridden", async () => {
		const component = await createComponent();
		const list = component.getResourceList();
		list.handleInput("\t");

		const fooLine = () => component.render(120).find((line) => stripAnsi(line).includes("foo"))!;
		const dimmedText = theme.fg("dim", "probe");
		const dimEscape = dimmedText.slice(0, dimmedText.indexOf("probe"));
		expect(fooLine()).toContain(dimEscape);

		list.handleInput(" ");
		expect(fooLine()).not.toContain(dimEscape);
		expect(stripAnsi(fooLine())).toContain("project unload");
	});

	it("cycles an inherited-global resource inherit → unload → load → inherit, replacing entries idempotently", async () => {
		const component = await createComponent();
		const list = component.getResourceList();
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");
		const globalSettingsPath = join(agentDir, "settings.json");
		const fooPath = join(agentDir, "skills", "foo", "SKILL.md");
		const readProjectSkills = () => JSON.parse(readFileSync(projectSettingsPath, "utf-8")).skills;

		list.handleInput("\t");

		// inherit → unload
		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([fooPath, `-${fooPath}`]);
		expect(renderPlain(component)).toContain("project unload");

		// unload → load (entry replaced, not duplicated)
		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([fooPath, `+${fooPath}`]);
		expect(renderPlain(component)).toContain("project load");

		// load → inherit (entries removed)
		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([]);
		const plain = renderPlain(component);
		expect(plain).toContain("inherited global");
		expect(plain).not.toContain("project unload");
		expect(plain).not.toContain("project load");

		// Unloading a global skill here never touches the global settings file.
		expect(existsSync(globalSettingsPath)).toBe(false);
	});

	it("cycles a globally disabled resource inherit → load → unload → inherit", async () => {
		settingsManager.setSkillPaths(["-skills/foo/SKILL.md"]);
		await settingsManager.flush();
		const component = await createComponent();
		const list = component.getResourceList();
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");
		const fooPath = join(agentDir, "skills", "foo", "SKILL.md");
		const readProjectSkills = () => JSON.parse(readFileSync(projectSettingsPath, "utf-8")).skills;

		list.handleInput("\t");
		expect(renderPlain(component)).toContain("[ ]");

		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([fooPath, `+${fooPath}`]);
		expect(renderPlain(component)).toContain("project load");

		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([fooPath, `-${fooPath}`]);
		expect(renderPlain(component)).toContain("project unload");

		list.handleInput(" ");
		await settingsManager.flush();
		expect(readProjectSkills()).toEqual([]);
	});

	it("a project override of a user resource wins by precedence in a fresh resolution", async () => {
		const component = await createComponent();
		const list = component.getResourceList();
		list.handleInput("\t");
		list.handleInput(" ");
		await settingsManager.flush();

		const packageManager = new DefaultPackageManager({
			cwd: projectDir,
			agentDir,
			settingsManager: SettingsManager.create(projectDir, agentDir),
			bundledSkillsDir: null,
		});
		const scoped = await packageManager.resolveScoped();
		const fooInProject = scoped.project.skills.find((r) => r.path === join(agentDir, "skills", "foo", "SKILL.md"));
		const fooInGlobal = scoped.global.skills.find((r) => r.path === join(agentDir, "skills", "foo", "SKILL.md"));
		expect(fooInProject?.enabled).toBe(false);
		expect(fooInGlobal?.enabled).toBe(true);
	});

	it("creates the project settings file lazily on the first override", async () => {
		const component = await createComponent();
		const list = component.getResourceList();
		const projectSettingsPath = join(projectDir, ".prime", "agent", "settings.json");

		list.handleInput("\t");
		component.render(120);
		expect(existsSync(projectSettingsPath)).toBe(false);

		list.handleInput(" ");
		await settingsManager.flush();
		expect(existsSync(projectSettingsPath)).toBe(true);
	});
});
