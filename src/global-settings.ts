import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installApplicationNotices } from './application-notices';
import { installNativePreferences } from './native-preferences';
import { installSettingsSurface } from './settings-surface';
import { isApplicationAction, runApplicationAction } from './application-actions';
import { installKeybindingDispatch } from './keybindings';
import { installWindowPresentation } from './window-presentation';

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
    appearanceReady = surface.ready;
    const section = document.createElement('section'); section.className = 'settings-project-overrides';
    const heading = document.createElement('h2'); heading.textContent = 'Open projects with overrides';
    const description = document.createElement('p'); description.className = 'settings-hint'; description.textContent = 'These projects keep their explicit values when global defaults change.';
    const links = document.createElement('div'); links.className = 'settings-project-links';
    section.append(heading, description, links); document.getElementById('settings-panel-appearance')!.append(section);
    let generation = 0, projectSignature: string | undefined;
    const labels: Record<string, string> = { 'appearance.theme': 'Theme', 'runtime.piPath': 'Pi path', 'runtime.nodePath': 'Node path', 'runtime.copilotPath': 'Copilot path' };
    async function reloadProjects() {
      const request = ++generation;
      try {
        const projects = await invoke<{ cwd: string; keys: string[] }[]>('list_project_overrides');
        if (presentation.disposed || request !== generation) return;
        notices.resolve('project-overrides');
        const signature = JSON.stringify(projects);
        if (signature === projectSignature) return;
        projectSignature = signature;
        const active = document.activeElement;
        const focusedProject = links.contains(active) ? (active as HTMLElement).dataset.cwd : undefined;
        const buttons = projects.map(project => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
          button.textContent = (project.cwd.split(/[\\/]/).filter(Boolean).pop() ?? project.cwd) + ' — ' + project.keys.map(key => labels[key] ?? key).join(', ');
          button.title = project.cwd; button.dataset.cwd = project.cwd; button.setAttribute('aria-label', 'Open project settings for ' + project.cwd);
          button.addEventListener('click', () => { void invoke('open_owned_project_settings', { cwd: project.cwd }).catch(error => notices.report({ id: 'project-settings', operation: 'Open project settings', message: String(error) })); });
          return button;
        });
        links.replaceChildren(...buttons);
        if (!projects.length) links.textContent = 'No open project has overrides.';
        if (focusedProject && document.hasFocus() && document.activeElement === document.body) buttons.find(button => button.dataset.cwd === focusedProject)?.focus({ preventScroll: true });
      } catch (error) { if (!presentation.disposed) notices.report({ id: 'project-overrides', operation: 'Read project overrides', message: String(error) }); }
    }
    presentation.own(await listen('nimrod-preferences', () => { void reloadProjects(); }));
    if (presentation.disposed) return;
    presentation.own(await getCurrentWindow().onFocusChanged(event => { if (event.payload) void reloadProjects(); }));
    if (presentation.disposed) return;
    void reloadProjects();
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
      enabled: id => isApplicationAction(window, id) || ['settings', 'keybindings', 'close', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(id),
      run: id => {
        if (isApplicationAction(window, id)) return runApplicationAction(id);
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
    // PATH/mise discovery can take seconds; do not gate first presentation on it.
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
