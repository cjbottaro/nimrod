import { invoke } from '@tauri-apps/api/core';
import { actionsForWindow, type BuiltinActionDefinition, type ActionId } from './keybindings';

type ApplicationAction = Extract<BuiltinActionDefinition, { platform: 'linux' }>;
export type ApplicationActionId = ApplicationAction['id'];

/** Linux's menuless app actions. macOS keeps its native menu/accelerators. */
export function applicationActions(window: Window) {
  return actionsForWindow(window).filter((action): action is ApplicationAction => 'platform' in action && action.platform === 'linux');
}
export function isApplicationAction(window: Window, id: ActionId): id is ApplicationActionId {
  return applicationActions(window).some(action => action.id === id);
}
export function runApplicationAction(id: ApplicationActionId): Promise<void> {
  return invoke('application_action', { action: id });
}
export function applicationCommands(window: Window, run: (id: ApplicationActionId) => Promise<void> = runApplicationAction) {
  const details: Record<ApplicationActionId, string> = {
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
