import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { installPreferences, type PreferencesSnapshot } from './preferences';

/** Broadcasts invalidate the cache; each window reloads only its owned scope. */
export function installNativePreferences(report: (error?: string) => void) {
  let cached: PreferencesSnapshot | undefined;
  const snapshot = async () => {
    const next = await invoke<PreferencesSnapshot>('scoped_preferences_snapshot');
    if (!cached || next.revision >= cached.revision && (next.projectRevision ?? 0) >= (cached.projectRevision ?? 0)) cached = next;
    return next;
  };
  return installPreferences({
    snapshot,
    settings: async (expected, text) => { await invoke('preferences_settings', { expected, text }); return snapshot(); },
    projectSettings: (expected, text) => invoke('project_preferences_settings', { expected, text }),
    state: async entries => { await invoke('preferences_state', { entries }); return snapshot(); },
    commandUsage: async id => { await invoke('record_command_usage', { id }); return snapshot(); },
    migrate: async (text, entries) => { await invoke('preferences_migrate', { text, entries }); return snapshot(); },
    listen: receive => listen<PreferencesSnapshot>('nimrod-preferences', event => {
      // Global broadcasts already carry an authoritative snapshot. Apply those
      // keys immediately against the last project layer; fetch the project layer
      // separately because a project-file invalidation may share global revision.
      const global = event.payload;
      receive('projectText' in global ? global : { ...global,
        projectPath: cached?.projectPath, projectText: cached?.projectText,
        projectError: cached?.projectError, projectRevision: cached?.projectRevision,
      });
      void snapshot().then(receive).catch(error => report(`Could not refresh settings: ${String(error)}`));
    }),
  }, localStorage, report);
}
