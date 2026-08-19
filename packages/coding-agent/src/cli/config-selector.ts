import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import type { ScopedResolvedPaths } from "../core/package-manager.js";
import type { SettingsManager } from "../core/settings-manager.js";
import { ConfigSelectorComponent, type ConfigWriteScope } from "../modes/interactive/components/config-selector.js";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ScopedResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
	/** Which pane the selector opens in. */
	writeScope: ConfigWriteScope;
}

export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	initTheme(options.settingsManager.getTheme(), true);

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new ConfigSelectorComponent(
			options.resolvedPaths,
			options.settingsManager,
			options.cwd,
			options.agentDir,
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					stopThemeWatcher();
					resolve();
				}
			},
			() => {
				ui.stop();
				stopThemeWatcher();
				process.exit(0);
			},
			() => ui.requestRender(),
			ui.terminal.rows,
			options.writeScope,
		);

		ui.addChild(selector);
		ui.setFocus(selector.getResourceList());
		ui.start();
	});
}
