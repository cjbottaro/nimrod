import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { runtimePaths, RUNTIME_STORAGE_KEY } from './settings';
import { readLibrary, THEME_STORAGE_KEY, type ThemeLibrary } from './themes/theme';
import { DEFAULT_ZOOM, ZOOM_LEVELS, ZOOM_STORAGE_KEY } from './zoom';
import { KEYBINDINGS_SETTING, readKeyOverrides, changeBinding, bindingsFor, type ActionId } from './keybindings';

export interface PreferencesSnapshot {
  text: string;
  state: Record<string, unknown>;
  settingsPath: string;
  statePath: string;
  error?: string | null;
  revision: number;
}
export interface PreferencesHost {
  snapshot(): Promise<PreferencesSnapshot>;
  settings(expected: string, text: string): Promise<PreferencesSnapshot>;
  state(entries: Record<string, unknown>): Promise<PreferencesSnapshot>;
  migrate(text: string, entries: Record<string, unknown>): Promise<PreferencesSnapshot>;
  listen(receive: (snapshot: PreferencesSnapshot) => void): Promise<() => void>;
}
export function parseSettings(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const settings = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings must be a valid JSON/JSONC object.');
  if (settings['notifications.enabled'] !== undefined && typeof settings['notifications.enabled'] !== 'boolean') throw new Error('notifications.enabled must be a boolean.');
  readKeyOverrides(settings[KEYBINDINGS_SETTING]);
  const zoom = settings['appearance.zoom'];
  if (zoom !== undefined && !ZOOM_LEVELS.includes(zoom)) throw new Error('Invalid appearance.zoom percentage.');
  for (const key of ['runtime.piPath', 'runtime.nodePath']) {
    if (settings[key] !== undefined) runtimePaths({ pi: settings[key], node: settings[key] });
  }
  if (settings['appearance.theme'] !== undefined && typeof settings['appearance.theme'] !== 'string') throw new Error('appearance.theme must be a string.');
  const selected = settings['appearance.theme'] ?? 'nimrod';
  const library = readLibrary({ version: 1, selected, imports: settings['appearance.importedThemes'] ?? [] });
  if (library.selected !== selected) throw new Error('appearance.theme must name a built-in or imported theme.');
  return settings;
}
export function editSettings(text: string, values: Record<string, unknown>): string {
  parseSettings(text);
  for (const [key, value] of Object.entries(values)) {
    text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  parseSettings(text);
  return text;
}
const stateKey = (key: string) => ['nimrod.poc.launch', 'nimrod.workspaces.v1', 'nimrod.last-session.v1', 'nimrod.sidebar.visible'].includes(key) || key.startsWith('nimrod.tabs.v1:');
export function legacyPreferences(storage: Storage): { text: string; entries: Record<string, unknown> } {
  const read = (key: string) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
  const settings: Record<string, unknown> = {};
  const zoom = read(ZOOM_STORAGE_KEY);
  if (ZOOM_LEVELS.includes(zoom)) settings['appearance.zoom'] = zoom;
  const savedRuntime = read(RUNTIME_STORAGE_KEY);
  const runtime = savedRuntime?.version === 1 ? savedRuntime : read('nimrod.poc.launch');
  for (const [field, key] of [['pi', 'runtime.piPath'], ['node', 'runtime.nodePath']]) {
    const value = runtime?.[field];
    if (value !== undefined) {
      try { settings[key] = runtimePaths({ pi: value, node: value }).pi; } catch { /* discovery remains the fallback for this path */ }
    }
  }
  try {
    const library = readLibrary(read(THEME_STORAGE_KEY));
    settings['appearance.theme'] = library.selected;
    if (library.imports.length) settings['appearance.importedThemes'] = library.imports;
  } catch { /* retain invalid legacy data untouched, use defaults */ }
  const entries: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    if (stateKey(key)) {
      const value = read(key);
      if (value !== null) entries[key] = key === 'nimrod.poc.launch' ? { cwd: value.cwd } : value;
    }
  }
  return { text: `// Nimrod preferences. Comments and trailing commas are supported.\n${JSON.stringify(settings, null, 2)}\n`, entries };
}

/** One native writer, revision-ordered broadcasts, and compare-and-swap JSONC edits. */
export async function installPreferences(host: PreferencesHost, storage: Storage, report: (error?: string) => void) {
  let snapshot: PreferencesSnapshot | undefined;
  let settings: Record<string, unknown> = {};
  let disposed = false;
  let work = Promise.resolve();
  const subscribers = new Set<() => void>();
  const receive = (next: PreferencesSnapshot) => {
    if (disposed || (snapshot && next.revision < snapshot.revision)) return;
    try {
      const parsed = parseSettings(next.text);
      const changed = !snapshot || snapshot.text !== next.text || JSON.stringify(snapshot.state) !== JSON.stringify(next.state);
      snapshot = next; settings = parsed;
      report(next.error ?? undefined);
      if (changed) for (const subscriber of subscribers) subscriber();
    } catch (error) {
      const message = `${next.settingsPath}: ${String(error)}. Keeping the last valid settings.`;
      snapshot = { ...next, text: snapshot?.text ?? '{}\n', error: message };
      report(message);
    }
  };
  const unlisten = await host.listen(receive);
  try {
    receive(await host.snapshot());
    if (snapshot?.state.legacyMigrated !== true) {
      const legacy = legacyPreferences(storage);
      receive(await host.migrate(legacy.text, legacy.entries));
    }
    if (!snapshot) throw new Error('Could not load settings. Correct settings.json and reopen the window.');
  } catch (error) { unlisten(); throw error; }
  const enqueue = (operation: () => Promise<void>) => {
    const result = work.then(operation);
    work = result.catch(() => {});
    return result;
  };
  const patch = (values: Record<string, unknown>) => enqueue(async () => {
    // Read immediately before editing: unrelated changes in another window survive.
    receive(await host.snapshot());
    if (!snapshot) throw new Error('Preferences unavailable.');
    if (snapshot.error) throw new Error(snapshot.error);
    const text = editSettings(snapshot.text, values);
    if (text === snapshot.text) return;
    try { receive(await host.settings(snapshot.text, text)); }
    catch (error) { receive(await host.snapshot()); throw error; }
  });
  return {
    subscribe(callback: () => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
    runtime(defaults: { pi: string; node: string }) { return { version: 1 as const, pi: settings['runtime.piPath'] as string ?? defaults.pi, node: settings['runtime.nodePath'] as string ?? defaults.node }; },
    saveRuntime(paths: { pi: string; node: string }) { return patch({ 'runtime.piPath': paths.pi, 'runtime.nodePath': paths.node }); },
    theme(): ThemeLibrary { return readLibrary({ version: 1, selected: settings['appearance.theme'] ?? 'nimrod', imports: settings['appearance.importedThemes'] ?? [] }); },
    saveTheme(library: ThemeLibrary) {
      // Don't rewrite the import library on a simple selection change.
      const values: Record<string, unknown> = { 'appearance.theme': library.selected };
      if (JSON.stringify(library.imports) !== JSON.stringify(settings['appearance.importedThemes'] ?? [])) values['appearance.importedThemes'] = library.imports;
      return patch(values);
    },
    keybindings() { return readKeyOverrides(settings[KEYBINDINGS_SETTING]); },
    saveKeybinding(id: ActionId, bindings: readonly string[] | undefined, reassign: boolean, mac: boolean) {
      const before = readKeyOverrides(settings[KEYBINDINGS_SETTING]);
      const reviewed = changeBinding(before, id, bindings, reassign, mac);
      return enqueue(async () => {
        receive(await host.snapshot());
        if (!snapshot || snapshot.error) throw new Error(snapshot?.error || 'Preferences unavailable.');
        // Compute reassignment against the latest source and edit only affected action
        // properties, preserving unrelated action edits and JSONC comments.
        const latest = readKeyOverrides(settings[KEYBINDINGS_SETTING]);
        if (JSON.stringify(bindingsFor(id, latest)) !== JSON.stringify(bindingsFor(id, before))) throw new Error('This action changed. Review its updated shortcuts and save again.');
        const changes = changeBinding(latest, id, bindings, reassign, mac);
        if (JSON.stringify(changes) !== JSON.stringify(reviewed)) throw new Error('Keybinding conflicts changed. Review the updated shortcuts and save again.');
        let text = snapshot.text;
        for (const [action, shortcuts] of Object.entries(changes)) {
          text = applyEdits(text, modify(text, [KEYBINDINGS_SETTING, action], shortcuts, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
        }
        parseSettings(text);
        if (text === snapshot.text) return;
        try { receive(await host.settings(snapshot.text, text)); }
        catch (error) { receive(await host.snapshot()); throw error; }
      });
    },
    resetKeybindings() { return patch({ [KEYBINDINGS_SETTING]: {} }); },
    notificationsEnabled() { return settings['notifications.enabled'] !== false; },
    saveNotifications(enabled: boolean) { return patch({ 'notifications.enabled': enabled }); },
    zoom() { return settings['appearance.zoom'] ?? DEFAULT_ZOOM; },
    saveZoom(percent: number) { return patch({ 'appearance.zoom': percent }); },
    readState(key: string) { return snapshot?.state[key]; },
    saveState(key: string, value: unknown) {
      return enqueue(async () => { receive(await host.state({ [key]: value })); });
    },
    get paths() { return { settings: snapshot!.settingsPath, state: snapshot!.statePath }; },
    dispose() { disposed = true; unlisten(); subscribers.clear(); },
  };
}
