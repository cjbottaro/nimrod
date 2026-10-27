import type { ConfigurationOperation } from './session-configuration';

/** Composer-facing metadata, not a harness wire schema. Arguments remain literal. */
export interface SlashCommand {
  name: string; description: string; source: 'GUI' | 'Extension' | 'Template' | 'Skill' | 'Agent';
  aliases?: readonly string[];
  allowDuringAgentExecution?: boolean;
  input?: {
    hint: string; required?: boolean; choices?: { name: string; description: string }[]; valueHint?: string;
    valueChoices?: Record<string, { name: string; description: string }[]>;
  };
}
export interface CommandCatalog { readonly revision: number; readonly commands: readonly SlashCommand[]; }
export interface CommandInvocation { readonly id: string; readonly text: string; }
/** Required session consumer port. Invocation settlement is not transport acknowledgement.
 * Operations are connection-local and publish through the ordinary view snapshot.
 */
export interface SessionCommands {
  catalog(): CommandCatalog;
  validate(text: string): string | undefined;
  invoke(invocation: CommandInvocation): Promise<void>;
  readonly operations: readonly ConfigurationOperation[];
  cancel(key?: string): void;
}
export interface CommandChoice { id: string; label: string; detail?: string; }
export interface CommandInteraction {
  choice(title: string, choices: readonly CommandChoice[], signal: AbortSignal): Promise<string | undefined>;
  input(title: string, signal: AbortSignal): Promise<string | undefined>;
}
export function parseCommand(text: string): { name: string; input?: string } | undefined {
  const match = /^\/([^\s/]+)(?:[ \t]([\s\S]*))?$/.exec(text.trimStart());
  return match ? { name: match[1], ...(match[2] !== undefined ? { input: match[2] } : {}) } : undefined;
}
export function findCommand(commands: readonly SlashCommand[], name: string): SlashCommand | undefined {
  const key = name.toLowerCase();
  return commands.find(command => command.name.toLowerCase() === key)
    ?? commands.find(command => command.aliases?.some(alias => alias.toLowerCase() === key));
}
export function commandSuggestions(commands: readonly SlashCommand[]): SlashCommand[] {
  const result = [...commands], names = new Set(commands.map(command => command.name.toLowerCase()));
  for (const command of commands) for (const name of command.aliases ?? []) {
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase()); result.push({ ...command, name, description: `${command.description} (/${command.name})` });
  }
  return result;
}
/** Cache revisions by metadata, not mutable controller identity. */
export function commandCatalog(read: () => readonly SlashCommand[]): () => CommandCatalog {
  let signature = '', source: readonly SlashCommand[] | undefined, snapshot: CommandCatalog = { revision: 0, commands: [] };
  return () => {
    const commands = read(); if (commands === source) return snapshot;
    source = commands; const next = JSON.stringify(commands);
    if (next !== signature) { signature = next; snapshot = { revision: snapshot.revision + 1, commands }; }
    return snapshot;
  };
}
/** Reconnect-safe facade. Each invocation captures exactly one concrete owner. */
export function bindSessionCommands(read: () => SessionCommands | undefined, available: () => boolean): SessionCommands {
  const unavailable = 'Connect this session before invoking commands. Your draft was kept.';
  return {
    catalog: commandCatalog(() => read()?.catalog().commands ?? []),
    validate: text => { const owner = read(); return available() && owner ? owner.validate(text) : unavailable; },
    async invoke(invocation) {
      const owner = read();
      if (!available() || !owner) throw new Error(unavailable);
      const error = owner.validate(invocation.text); if (error) throw new Error(error);
      await owner.invoke(invocation);
    },
    get operations() { return read()?.operations ?? []; },
    cancel: key => read()?.cancel(key),
  };
}
export function unsupportedCommands(reason: string): SessionCommands {
  return { catalog: () => ({ revision: 0, commands: [] }), validate: () => reason,
    async invoke() { throw new Error(reason); }, operations: [], cancel() {} };
}
/** Only concrete adapters may classify ambiguous delivery or unsupported confirmation. */
export class CommandUncertain extends Error {}

interface CommandIntent {
  id: string; key: string; text: string; signal: AbortController; dispatched: boolean; resolve(): void;
}
/** FIFO intent mechanics extracted from Copilot; readiness remains integration-owned. */
export class SessionCommandQueue {
  operations: readonly ConfigurationOperation[] = [];
  private pending: CommandIntent[] = [];
  private active?: CommandIntent;
  private disposed = false;
  constructor(private ready: (text: string) => boolean,
    private run: (id: string, text: string, signal: AbortSignal, dispatched: () => void) => Promise<void | boolean>,
    private changed: () => void, private label = 'Harness') {}
  get occupied(): boolean { return !!this.active || this.pending.length > 0; }
  enqueue(id: string, text: string, settlementAnchor: string | null): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The command connection ended. Nothing was invoked.'));
    return new Promise(resolve => {
      const intent: CommandIntent = { id, key: `command-intent:${crypto.randomUUID()}`, text,
        signal: new AbortController(), dispatched: false, resolve };
      this.pending.push(intent);
      this.operations = [...this.operations, { key: intent.key, phase: 'queued', title: `${this.label} command`, text, settlementAnchor, cancellable: true }];
      this.changed(); this.update();
    });
  }
  update(): void {
    if (this.disposed || this.active || !this.pending.length || !this.ready(this.pending[0].text)) return;
    const intent = this.pending.shift()!; this.active = intent;
    this.progress(intent, 'applying');
    void this.run(intent.id, intent.text, intent.signal.signal, () => {
      intent.dispatched = true; this.progress(intent, 'applying');
    }).then(result => {
      if (!intent.signal.signal.aborted) {
        if (result === false && !intent.dispatched) { this.remove(intent); this.changed(); }
        else if (result === false) this.progress(intent, 'not-applied', 'The command interaction was cancelled. No further invocation was made; earlier command steps were not rolled back.');
        else this.progress(intent, 'completed');
      }
    }, error => {
      if (!intent.signal.signal.aborted) this.progress(intent, error instanceof CommandUncertain ? 'unknown' : 'failed', error instanceof Error ? error.message : String(error));
    }).finally(() => { this.active = undefined; intent.resolve(); this.changed(); this.update(); });
  }
  output(text: string, markdown = false): void {
    const intent = this.active; if (!intent || intent.signal.signal.aborted) return;
    this.operations = this.operations.map(operation => operation.key === intent.key
      ? { ...operation, commandOutput: [...(operation.commandOutput ?? []), { text, markdown }] } : operation);
    this.changed();
  }
  cancel(reason?: string, key?: string): void {
    if (reason) this.disposed = true;
    const pending = this.pending.filter(intent => !key || intent.key === key);
    this.pending = this.pending.filter(intent => !pending.includes(intent));
    for (const intent of pending) {
      intent.signal.abort();
      if (reason) this.progress(intent, 'not-applied', `${reason} This command was not dispatched.`, true);
      else this.remove(intent);
      intent.resolve();
    }
    if (this.active && (!key || this.active.key === key)) {
      const intent = this.active; intent.signal.abort();
      if (intent.dispatched) this.progress(intent, 'unknown', `${reason || 'The command interaction was cancelled.'} An invocation was dispatched; its effects were not rolled back or retried.`, !!reason);
      else if (reason) this.progress(intent, 'not-applied', `${reason} This command was not dispatched.`, true);
      else this.remove(intent);
    }
    this.changed();
  }
  private remove(intent: CommandIntent): void { this.operations = this.operations.filter(operation => operation.key !== intent.key); }
  private progress(intent: CommandIntent, phase: ConfigurationOperation['phase'], details?: string, connection = false): void {
    this.operations = this.operations.map(operation => operation.key === intent.key
      ? { ...operation, phase, cancellable: !intent.dispatched && (phase === 'queued' || phase === 'applying'),
        details: phase === 'failed' ? undefined : details, inlineError: phase === 'failed' ? details : undefined,
        ...(connection ? { cause: 'connection' as const } : {}) } : operation);
    this.changed();
  }
}
