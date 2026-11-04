import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installApplicationNotices } from './application-notices';
import { installNativePreferences } from './native-preferences';
import { installSettingsSurface } from './settings-surface';
import { isApplicationAction, runApplicationAction } from './application-actions';
import { installKeybindingDispatch } from './keybindings';
import { installWindowPresentation } from './window-presentation';
import { installCommandPalette } from './command-palette';
import { createThemeSelection } from './themes/selection';
import { settingsChoicePage } from './settings-choice-controls';

/** Deliberately separate boot: global Settings never mounts session controllers. */
export async function mountGlobalSettings() {
  let appearanceReady = Promise.resolve();
  const presentation = installWindowPresentation(window, {
    layout: () => { document.getElementById('settings-page')!.getBoundingClientRect(); },
    reveal: () => invoke('settings_window_ready', { generation: new URLSearchParams(location.search).get('settingsGeneration') ?? '' }),
  });
  for (const id of ['workspace-bar', 'workspace-layout']) document.getElementById(id)!.hidden = true;
  const notices = installApplicationNotices(window);
  presentation.own(() => notices.dispose());
  const report = (message?: string) => {
    if (presentation.disposed) return;
    if (message) notices.report({ id: 'preferences', operation: 'Read global settings', message }); else notices.resolve('preferences');
  };
  try {
    const preferences = await installNativePreferences(report);
    presentation.own(() => preferences.dispose());
    if (presentation.disposed) return;
    const surface = installSettingsSurface(preferences, notices, true);
    presentation.own(() => surface.dispose());
    const palette = installCommandPalette(window, document.getElementById('command-palette') as HTMLDialogElement, {
      canOpen: () => !presentation.disposed, shortcuts: false,
      commands: () => [{ id: 'select-theme', label: 'Select theme…', detail: 'Preview bundled themes and saved imports', next: true, run: () => selectTheme() }],
      sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }),
      error: (message, operation) => notices.report({ id: 'settings-theme-action', operation, message }),
    });
    const selectTheme = createThemeSelection(palette, preferences, surface.themes);
    surface.onSelectTheme(selectTheme);
    surface.onChooseSetting(settingsChoicePage(palette, document.getElementById('settings-page') as HTMLDialogElement));
    presentation.own(() => palette.dispose());
    appearanceReady = surface.ready;
    surface.settings.open();
    if (new URLSearchParams(location.search).get('settings') === 'keybindings') surface.openKeybindings();
    const takeCategory = async () => {
      const requested = await invoke<boolean>('take_settings_category');
      if (!presentation.disposed && requested) surface.openKeybindings();
    };
    presentation.own(await listen('nimrod-settings-category', () => { void takeCategory().catch(error => report(String(error))); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } }));
    if (presentation.disposed) return;
    await takeCategory();
    if (presentation.disposed) return;
    const dispatch = installKeybindingDispatch(window, {
      read: () => preferences.keybindings(), settingsWindow: true,
      enabled: id => isApplicationAction(window, id) || ['settings', 'keybindings', 'select-theme', 'close', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(id),
      run: id => {
        if (isApplicationAction(window, id)) return runApplicationAction(id);
        if (id === 'select-theme') return selectTheme();
        if (id === 'keybindings') surface.openKeybindings();
        if (id === 'close') return getCurrentWindow().close();
        if (id === 'zoom-in') surface.zoom.run('in');
        if (id === 'zoom-out') surface.zoom.run('out');
        if (id === 'zoom-reset') surface.zoom.run('reset');
      },
      error: error => notices.report({ id: 'settings-action', operation: 'Settings action', message: String(error) }),
    });
    presentation.own(() => dispatch.dispose());
    await presentation.presentWhenPrepared(() => surface.settled());
    if (presentation.disposed) return;
    // Runtime defaults initialize separately; do not gate first presentation on them.
    void invoke<{ pi: string; node: string }>('runtime_defaults').then(defaults => {
      if (!presentation.disposed) surface.initializeRuntime(defaults);
    }).catch(error => { if (!presentation.disposed) notices.report({ id: 'runtime-defaults', operation: 'Detect runtime paths', message: String(error) }); });
  } catch (error) {
    if (presentation.disposed) return;
    report(`Could not open Settings: ${String(error)}`);
    // Startup errors must be readable, not leave a permanently hidden singleton.
    try { await presentation.presentWhenPrepared(() => appearanceReady); }
    catch (error) { if (!presentation.disposed) report(`Could not show Settings: ${String(error)}`); }
  }
}
