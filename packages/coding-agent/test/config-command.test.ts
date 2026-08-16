import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCommandHelp } from "../src/cli/command-registry.js";

vi.mock("../src/cli/config-selector.js", () => ({
	selectConfig: vi.fn(async () => {}),
}));

vi.mock("../src/core/package-manager.js", () => ({
	DefaultPackageManager: class {
		resolveScoped = vi.fn(async () => ({
			global: { extensions: [], skills: [], prompts: [], themes: [], diagnostics: [] },
			project: { extensions: [], skills: [], prompts: [], themes: [], diagnostics: [] },
		}));
	},
}));

import { selectConfig } from "../src/cli/config-selector.js";
import { handleConfigCommand } from "../src/package-manager-cli.js";

describe("handleConfigCommand", () => {
	beforeEach(() => {
		vi.mocked(selectConfig).mockClear();
		vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		process.exitCode = 0;
	});

	it("starts in the global pane without flags", async () => {
		const handled = await handleConfigCommand(["config"]);

		expect(handled).toBe(true);
		expect(selectConfig).toHaveBeenCalledTimes(1);
		expect(vi.mocked(selectConfig).mock.calls[0]?.[0]).toMatchObject({ writeScope: "global" });
	});

	it("starts in the project pane with -l", async () => {
		await handleConfigCommand(["config", "-l"]);

		expect(vi.mocked(selectConfig).mock.calls[0]?.[0]).toMatchObject({ writeScope: "project" });
	});

	it("starts in the project pane with --local", async () => {
		await handleConfigCommand(["config", "--local"]);

		expect(vi.mocked(selectConfig).mock.calls[0]?.[0]).toMatchObject({ writeScope: "project" });
	});

	it("rejects an unknown option with usage", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const handled = await handleConfigCommand(["config", "--project"]);

			expect(handled).toBe(true);
			expect(selectConfig).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Unknown option --project"));
		} finally {
			consoleError.mockRestore();
		}
	});

	it("rejects an unexpected argument with usage", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await handleConfigCommand(["config", "extra"]);

			expect(selectConfig).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
		} finally {
			consoleError.mockRestore();
		}
	});

	it("ignores non-config commands", async () => {
		const handled = await handleConfigCommand(["model", "list"]);

		expect(handled).toBe(false);
		expect(selectConfig).not.toHaveBeenCalled();
	});
});

describe("config command help", () => {
	it("documents -l and the Tab switch", () => {
		const help = formatCommandHelp(["config"]);

		expect(help).toContain("config [-l]");
		expect(help).toContain("-l, --local");
		expect(help).toContain("Tab");
	});
});
