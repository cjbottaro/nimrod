import { COMMAND_USAGE_KEY, COMMAND_HISTORY_LIMIT, readCommandUsage } from '../src/command-ranking';
import type { PreferencesHost, PreferencesSnapshot } from '../src/preferences';

/** In-memory native boundary. Never reads or writes the user's home directory. */
export class MemoryPreferences implements PreferencesHost {
  value: PreferencesSnapshot = { text: '{}\n', state: {}, revision: 0, settingsPath: '/fixture/.config/nimrod/settings.json', statePath: '/fixture/.local/state/nimrod/state.json' };
  receive?: (snapshot: PreferencesSnapshot) => void;
  snapshot = async () => structuredClone(this.value);
  listen = async (receive: (snapshot: PreferencesSnapshot) => void) => { this.receive = receive; return () => { this.receive = undefined; }; };
  settings = async (expected: string, text: string) => {
    if (expected !== this.value.text) throw new Error('Settings changed on disk');
    this.value.text = text; this.value.revision++; this.receive?.(structuredClone(this.value));
    return this.snapshot();
  };
  state = async (entries: Record<string, unknown>) => {
    Object.assign(this.value.state, structuredClone(entries)); this.value.revision++; this.receive?.(structuredClone(this.value));
    return this.snapshot();
  };
  commandUsage = async (id: string) => {
    const entries = readCommandUsage(this.value.state[COMMAND_USAGE_KEY]);
    const useCount = (entries.find(entry => entry.id === id)?.useCount ?? 0) + 1;
    return this.state({ [COMMAND_USAGE_KEY]: { version: 1, entries: [
      { id, lastUsedAt: Date.now(), useCount }, ...entries.filter(entry => entry.id !== id),
    ].slice(0, COMMAND_HISTORY_LIMIT) } });
  };
  migrate = async (text: string, entries: Record<string, unknown>) => {
    if (!this.value.state.legacyMigrated) {
      if (this.value.text === '{}\n') this.value.text = text;
      this.value.state = { ...structuredClone(entries), ...this.value.state, legacyMigrated: true }; this.value.revision++;
    }
    return this.snapshot();
  };
  external(text: string, error?: string) {
    this.value.text = text; this.value.error = error; this.value.revision++;
    this.receive?.(structuredClone(this.value));
  }
  async invoke(command: string, args: Record<string, unknown>) {
    if (command === 'preferences_snapshot') return this.snapshot();
    if (command === 'preferences_migrate') return this.migrate(String(args.text), args.entries as Record<string, unknown>);
    if (command === 'preferences_settings') return this.settings(String(args.expected), String(args.text));
    if (command === 'record_command_usage') return this.commandUsage(String(args.id));
    if (command === 'preferences_state') return this.state(args.entries as Record<string, unknown>);
    throw new Error(`Unexpected preferences command: ${command}`);
  }
}
