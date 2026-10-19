import { invoke } from '@tauri-apps/api/core';
import { actionsForWindow, type ActionId } from './keybindings';

/** Linux's menuless app actions. macOS keeps its native menu/accelerators. */
export function applicationActions(window: Window) {
  return actionsForWindow(window).filter(action => 'platform' in action && action.platform === 'linux');
}
export function isApplicationAction(window: Window, id: ActionId): boolean {
  return applicationActions(window).some(action => action.id === id);
}
export function runApplicationAction(id: ActionId): Promise<void> {
  return invoke('application_action', { action: id });
}
export function applicationCommands(window: Window, run: (id: ActionId) => Promise<void> = runApplicationAction) {
  const details: Partial<Record<ActionId, string>> = {
    'open-project': 'Choose a directory to open in its own project window',
    quit: 'Quit all Nimrod windows after saving drafts and stopping owned agents',
    'minimize-window': 'Minimize this window',
    'toggle-maximize-window': 'Toggle this window between maximized and restored',
    'close-window': 'Close this window using its normal shutdown path',
    about: 'Application version and license',
  };
  return applicationActions(window).map(action => ({
    id: action.id, label: action.label, detail: details[action.id], run: () => run(action.id),
  }));
}
