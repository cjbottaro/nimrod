import type { ConfigurationOperation } from '../session-configuration';

interface CommandIntent {
  id: string;
  key: string;
  text: string;
  signal: AbortController;
  dispatched: boolean;
  resolve(): void;
}
/** Connection-local command intents, not a prompt queue or a retry mechanism. */
export class CopilotCommandQueue {
  operations: readonly ConfigurationOperation[] = [];
  private pending: CommandIntent[] = [];
  private active?: CommandIntent;
  private disposed = false;
  constructor(private ready: () => boolean,
    private run: (id: string, text: string, signal: AbortSignal, dispatched: () => void) => Promise<void | boolean>,
    private changed: () => void) {}
  get occupied(): boolean { return !!this.active || this.pending.length > 0; }
  enqueue(id: string, text: string): Promise<void> {
    return new Promise(resolve => {
      const intent: CommandIntent = { id, key: `copilot:command-intent:${crypto.randomUUID()}`, text, signal: new AbortController(), dispatched: false, resolve };
      this.pending.push(intent);
      this.operations = [...this.operations, { key: intent.key, phase: 'queued', title: 'Copilot command', text }];
      this.changed(); this.update();
    });
  }
  update(): void {
    if (this.disposed || this.active || !this.pending.length || !this.ready()) return;
    const intent = this.pending.shift()!;
    this.active = intent;
    this.progress(intent, 'applying');
    void this.run(intent.id, intent.text, intent.signal.signal, () => { intent.dispatched = true; }).then(result => {
      if (!intent.signal.signal.aborted) {
        if (result === false) { this.remove(intent); this.changed(); }
        else this.progress(intent, 'completed');
      }
    }, error => {
      if (!intent.signal.signal.aborted) this.progress(intent, 'failed', String(error));
    }).finally(() => {
      this.active = undefined; intent.resolve(); this.changed(); this.update();
    });
  }
  cancel(reason?: string): void {
    if (reason) this.disposed = true;
    const pending = this.pending; this.pending = [];
    for (const intent of pending) {
      intent.signal.abort();
      if (reason) this.progress(intent, 'not-applied', `${reason} This command was not dispatched.`, true);
      else this.remove(intent);
      intent.resolve();
    }
    if (this.active) {
      const intent = this.active; intent.signal.abort();
      if (intent.dispatched) this.progress(intent, 'unknown', `${reason || 'The command interaction was cancelled.'} An invocation was dispatched; its effects were not rolled back or retried.`, !!reason);
      else if (reason) this.progress(intent, 'not-applied', `${reason} This command was not dispatched.`, true);
      else this.remove(intent);
    }
    this.changed();
  }
  private remove(intent: CommandIntent): void {
    this.operations = this.operations.filter(operation => operation.key !== intent.key);
  }
  private progress(intent: CommandIntent, phase: ConfigurationOperation['phase'], details?: string, connection = false): void {
    this.operations = this.operations.map(operation => operation.key === intent.key
      ? { ...operation, phase, details, ...(connection ? { cause: 'connection' as const } : {}) } : operation);
    this.changed();
  }
}
