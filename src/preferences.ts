import { DEFAULT_SEND_AUTO_FOLLOW, type SendAutoFollow } from './pi/transcript-scroll';
import { readPluginSettings } from './pi/card-plugins/declarative';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { runtimePaths, RUNTIME_STORAGE_KEY } from './settings';
import { readLibrary, THEME_STORAGE_KEY, MAX_IMPORTED_THEMES, type ColorTheme, type ThemeLibrary } from './themes/theme';
import { DEFAULT_ZOOM, ZOOM_LEVELS, ZOOM_STORAGE_KEY } from './zoom';
import { readWindowAppearance, APPEARANCE_KEYS, type WindowAppearance } from './window-appearance';
import { KEYBINDINGS_SETTING, readKeyOverrides, changeBinding, bindingsFor, type ActionId } from './keybindings';

export interface PreferencesSnapshot {
  text: string;
  state: Record<string, unknown>;
  settingsPath: string;
  statePath: string;
  error?: string | null;
  revision: number;
  projectText?: string | null;
  projectPath?: string | null;
  projectError?: string | null;
  projectRevision?: number;
}
export interface PreferencesHost {
  snapshot(): Promise<PreferencesSnapshot>;
  settings(expected: string, text: string): Promise<PreferencesSnapshot>;
  projectSettings?(expected: string, text: string): Promise<PreferencesSnapshot>;
  state(entries: Record<string, unknown>): Promise<PreferencesSnapshot>;
  commandUsage(id: string): Promise<PreferencesSnapshot>;
  migrate(text: string, entries: Record<string, unknown>): Promise<PreferencesSnapshot>;
  listen(receive: (snapshot: PreferencesSnapshot) => void): Promise<() => void>;
}
export const PROJECT_SETTING_KEYS = ['appearance.theme', 'runtime.piPath', 'runtime.nodePath'] as const;
// Retain these old project-file entries without applying or migrating them.
const LEGACY_PROJECT_SETTING_KEYS = ['appearance.zoom', 'appearance.autoFollowAfterSending'];
export type ProjectSettingKey = typeof PROJECT_SETTING_KEYS[number];

export function parseProjectSettings(text: string, global: Record<string, unknown>): Record<string, unknown> {
  const errors: ParseError[] = [];
  const project = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Project settings must be a valid JSON/JSONC object.');
  for (const key of Object.keys(project)) if (!(PROJECT_SETTING_KEYS as readonly string[]).includes(key) && !LEGACY_PROJECT_SETTING_KEYS.includes(key)) throw new Error(`${key} is global-only; edit global Settings instead.`);
  const overrides = Object.fromEntries(Object.entries(project).filter(([key]) => (PROJECT_SETTING_KEYS as readonly string[]).includes(key)));
  if (Object.keys(overrides).length) parseSettings(JSON.stringify({ ...global, ...overrides }));
  return overrides;
}

export function parseSettings(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const settings = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings must be a valid JSON/JSONC object.');
  if (settings['notifications.enabled'] !== undefined && typeof settings['notifications.enabled'] !== 'boolean') throw new Error('notifications.enabled must be a boolean.');
  if (settings['diagnostics.performance'] !== undefined && typeof settings['diagnostics.performance'] !== 'boolean') throw new Error('diagnostics.performance must be a boolean.');
  if (settings['diagnostics.toolCapture'] !== undefined && typeof settings['diagnostics.toolCapture'] !== 'boolean') throw new Error('diagnostics.toolCapture must be a boolean.');
  readWindowAppearance(settings);
  readKeyOverrides(settings[KEYBINDINGS_SETTING]);
  readPluginSettings(settings);
  const sendAutoFollow = settings['appearance.autoFollowAfterSending'];
  if (sendAutoFollow !== undefined && !['always', 'whenIdle', 'never'].includes(sendAutoFollow as string)) throw new Error('appearance.autoFollowAfterSending must be always, whenIdle or never.');
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
  let globalSettings: Record<string, unknown> = {};
  let projectSettings: Record<string, unknown> = {};
  let disposed = false;
  let work = Promise.resolve();
  const subscribers = new Set<() => void>();
  const receive = (next: PreferencesSnapshot) => {
    if (disposed || (snapshot && (next.revision < snapshot.revision || next.projectPath === snapshot.projectPath && (next.projectRevision ?? 0) < (snapshot.projectRevision ?? 0)))) return;
    try {
      const parsed = parseSettings(next.text);
      let project: Record<string, unknown>;
      try { project = next.projectText ? parseProjectSettings(next.projectText, parsed) : {}; }
      catch (error) {
        // A removed global import can invalidate an otherwise unchanged project
        // theme. Keep the last effective appearance, but let Use global default
        // remove that key through the same native source-CAS boundary.
        globalSettings = parsed;
        snapshot = { ...next, projectError: `${next.projectPath}: ${String(error)}. Keeping the last valid project settings.` };
        report(snapshot.projectError ?? undefined);
        for (const subscriber of subscribers) subscriber();
        return;
      }
      const changed = !snapshot || snapshot.text !== next.text || snapshot.projectText !== next.projectText || snapshot.projectPath !== next.projectPath || snapshot.projectError !== next.projectError || snapshot.error !== next.error || JSON.stringify(snapshot.state) !== JSON.stringify(next.state);
      snapshot = next; globalSettings = parsed; projectSettings = project; settings = { ...parsed, ...project };
      report(next.error ?? next.projectError ?? undefined);
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
  // Track the latest queued value per key, not merely the last received snapshot:
  // A → B → A must enqueue the final A even while the snapshot still contains A.
  const stateWrites = new Map<string, { signature: string | undefined }>();
  const saveState = (key: string, value: unknown): Promise<void> => {
    let signature: string | undefined;
    try {
      signature = JSON.stringify(value);
      // Capture the requested JSON value now; callers may mutate their objects
      // while an earlier preferences operation is still in flight.
      if (signature !== undefined) value = JSON.parse(signature);
    } catch (error) { return Promise.reject(error); }
    const pending = { signature };
    stateWrites.set(key, pending);
    const result = enqueue(async () => { receive(await host.state({ [key]: value })); });
    const settled = () => { if (stateWrites.get(key) === pending) stateWrites.delete(key); };
    void result.then(settled, settled);
    return result;
  };
  const patch = (values: Record<string, unknown>, project = !!snapshot?.projectPath) => enqueue(async () => {
    // Read immediately before editing: unrelated changes in another window survive.
    receive(await host.snapshot());
    if (!snapshot) throw new Error('Preferences unavailable.');
    if (snapshot.error) throw new Error(snapshot.error);
    if (project) {
      if (!snapshot.projectPath || !host.projectSettings) throw new Error('Open a project before editing project settings.');
      const expected = snapshot.projectText ?? '{}\n';
      let text = expected;
      for (const [key, value] of Object.entries(values)) {
        if (!(PROJECT_SETTING_KEYS as readonly string[]).includes(key)) throw new Error(`${key} is a global-only setting.`);
        text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
      }
      parseProjectSettings(text, globalSettings);
      if (text === expected) return;
      try { receive(await host.projectSettings(expected, text)); }
      catch (error) { receive(await host.snapshot()); throw error; }
    } else {
      const text = editSettings(snapshot.text, values);
      if (text === snapshot.text) return;
      try { receive(await host.settings(snapshot.text, text)); }
      catch (error) { receive(await host.snapshot()); throw error; }
    }
  });
  return {
    refresh: async () => { receive(await host.snapshot()); },
    get projectPath() { return snapshot?.projectPath ?? undefined; },
    isOverridden(key: ProjectSettingKey) { return Object.hasOwn(projectSettings, key); },
    useGlobal(key: ProjectSettingKey) { return patch({ [key]: undefined }, true); },
    subscribe(callback: () => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
    runtime(defaults: { pi: string; node: string }) { return { version: 1 as const, pi: settings['runtime.piPath'] as string ?? defaults.pi, node: settings['runtime.nodePath'] as string ?? defaults.node }; },
    saveRuntime(paths: { pi: string; node: string }, fields: ('pi' | 'node')[] = ['pi', 'node']) {
      return patch(Object.fromEntries(fields.map(key => [key === 'pi' ? 'runtime.piPath' : 'runtime.nodePath', paths[key]])));
    },
    theme(): ThemeLibrary { return readLibrary({ version: 1, selected: settings['appearance.theme'] ?? 'nimrod', imports: settings['appearance.importedThemes'] ?? [] }); },
    saveTheme(library: ThemeLibrary) {
      if (snapshot?.projectPath) {
        if (JSON.stringify(library.imports) !== JSON.stringify(globalSettings['appearance.importedThemes'] ?? [])) return Promise.reject(new Error('Import and remove themes in global Settings.'));
        return patch({ 'appearance.theme': library.selected });
      }
      // Don't rewrite the import library on a simple selection change.
      const values: Record<string, unknown> = { 'appearance.theme': library.selected };
      if (JSON.stringify(library.imports) !== JSON.stringify(settings['appearance.importedThemes'] ?? [])) values['appearance.importedThemes'] = library.imports;
      return patch(values);
    },
    selectTheme(id: string, theme?: ColorTheme) {
      if (snapshot?.projectPath) return patch({ 'appearance.theme': id });
      return enqueue(async () => {
        receive(await host.snapshot());
        if (!snapshot || snapshot.error) throw new Error(snapshot?.error || 'Preferences unavailable.');
        const library = readLibrary({ version: 1, selected: settings['appearance.theme'] ?? 'nimrod', imports: settings['appearance.importedThemes'] ?? [] });
        if (theme && !library.imports.some(item => item.id === id)) {
          if (library.imports.length >= MAX_IMPORTED_THEMES) throw new Error('At most 50 downloaded/imported themes can be saved. Remove one in Settings first.');
          library.imports.push(theme);
        }
        library.selected = id;
        const text = editSettings(snapshot.text, { 'appearance.theme': id, 'appearance.importedThemes': library.imports });
        try { receive(await host.settings(snapshot.text, text)); }
        catch (error) { receive(await host.snapshot()); throw error; }
      });
    },
    keybindings() { return readKeyOverrides(globalSettings[KEYBINDINGS_SETTING]); },
    saveKeybinding(id: ActionId, bindings: readonly string[] | undefined, reassign: boolean, mac: boolean) {
      const before = readKeyOverrides(globalSettings[KEYBINDINGS_SETTING]);
      const reviewed = changeBinding(before, id, bindings, reassign, mac);
      return enqueue(async () => {
        receive(await host.snapshot());
        if (!snapshot || snapshot.error) throw new Error(snapshot?.error || 'Preferences unavailable.');
        // Compute reassignment against the latest source and edit only affected action
        // properties, preserving unrelated action edits and JSONC comments.
        const latest = readKeyOverrides(globalSettings[KEYBINDINGS_SETTING]);
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
    resetKeybindings() { return patch({ [KEYBINDINGS_SETTING]: {} }, false); },
    cardPlugins() { return readPluginSettings(globalSettings); },
    toolCaptureEnabled() { return globalSettings['diagnostics.toolCapture'] === true; },
    saveToolCapture(enabled: boolean) { return patch({ 'diagnostics.toolCapture': enabled }, false); },
    performanceEnabled() { return globalSettings['diagnostics.performance'] === true; },
    savePerformance(enabled: boolean) { return patch({ 'diagnostics.performance': enabled }, false); },
    notificationsEnabled() { return globalSettings['notifications.enabled'] !== false; },
    saveNotifications(enabled: boolean) { return patch({ 'notifications.enabled': enabled }, false); },
    sendAutoFollow(): SendAutoFollow { return globalSettings['appearance.autoFollowAfterSending'] as SendAutoFollow ?? DEFAULT_SEND_AUTO_FOLLOW; },
    saveSendAutoFollow(mode: SendAutoFollow) { return patch({ 'appearance.autoFollowAfterSending': mode }, false); },
    windowAppearance() { return readWindowAppearance(globalSettings); },
    saveWindowAppearance(values: Partial<WindowAppearance>) {
      return patch(Object.fromEntries(Object.entries(values).map(([key, value]) => [APPEARANCE_KEYS[key as keyof WindowAppearance], value])), false);
    },
    zoom() { return globalSettings['appearance.zoom'] ?? DEFAULT_ZOOM; },
    saveZoom(percent: number) { return patch({ 'appearance.zoom': percent }, false); },
    recordCommandUsage(id: string) {
      return enqueue(async () => { receive(await host.commandUsage(id)); });
    },
    readState(key: string) { return snapshot?.state[key]; },
    saveState,
    // No request means no Promise/error handler for repeated streaming snapshots.
    // A failed write is removed from stateWrites, never cached as durable success.
    saveStateIfChanged(key: string, value: unknown): Promise<void> | undefined {
      let signature: string | undefined;
      try { signature = JSON.stringify(value); } catch (error) { return Promise.reject(error); }
      const pending = stateWrites.get(key);
      if (pending ? pending.signature === signature
        : snapshot && !snapshot.error && JSON.stringify(snapshot.state[key]) === signature) return;
      return saveState(key, value);
    },
    get paths() { return { settings: snapshot!.settingsPath, state: snapshot!.statePath }; },
    dispose() { disposed = true; unlisten(); subscribers.clear(); },
  };
}
