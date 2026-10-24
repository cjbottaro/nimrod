import { CodexClient } from './client';
import type { CodexTransport } from './native';
import { abortable, type SessionHistory, type SessionHistoryPage } from '../session-history';
import { ownedSessionStop } from '../session-lifecycle';
import { savedSessionKey } from '../session-list';
export const codexHistoryKey = (cwd: string) => `nimrod.history.codex.v1:${cwd}`;
/** Discovery has its own owned process and never binds or prompts a conversation. */
export class CodexSessionHistory implements SessionHistory {
  readonly id = 'codex'; readonly label = 'Codex';
  private owner: { token?: string } = {};
  private client?: CodexClient;
  private initializing?: Promise<void>;
  private launching?: Promise<string>;
  private disposed = false;
  private stop: () => Promise<void>;
  constructor(private cwd: string, private host: CodexTransport, private error: (error: unknown) => void) {
    this.stop = ownedSessionStop(() => this.owner, token => this.launching ? this.launching.then(() => host.stop(token), () => host.stop(token)) : host.stop(token));
  }
  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Codex history is closed'));
    if (this.client?.phase === 'ready') return Promise.resolve();
    if (this.initializing) return this.initializing;
    const task = this.start(); this.initializing = task;
    return task.finally(() => { if (this.initializing === task) this.initializing = undefined; });
  }
  private async start(): Promise<void> {
    await this.stop(); if (this.disposed) throw new Error('Codex history is closed');
    const token = crypto.randomUUID(); this.owner.token = token;
    const client = this.client = new CodexClient({ write: packet => this.host.write(token, packet) }, { disconnected: error => {
      if (!this.disposed) this.error(error);
      void this.stop().catch(error => this.error(error));
    } });
    try {
      this.launching = this.host.start(token, packet => client.receive(packet), reason => client.disconnect(reason));
      const confirmed = await this.launching;
      if (this.disposed || confirmed !== this.cwd) throw new Error('Codex history project was not confirmed');
      await client.initialize();
    } catch (error) { client.disconnect(error); await this.stop(); throw error; }
  }
  async list({ signal, cursor }: { signal: AbortSignal; cursor?: string }): Promise<SessionHistoryPage> {
    signal.throwIfAborted(); await abortable(this.initialize(), signal);
    const result = await abortable(this.client!.listThreads(this.cwd, cursor), signal); signal.throwIfAborted();
    return { warnings: [], nextCursor: result.nextCursor ?? undefined, entries: result.data.map(thread => {
      const reference = { kind: 'codex' as const, sessionId: thread.id };
      const timestamp = typeof thread.updatedAt === 'number' && thread.updatedAt > 0 ? thread.updatedAt * 1000 : undefined;
      return { key: savedSessionKey(reference), reference, title: typeof thread.name === 'string' && thread.name.trim() ? thread.name : typeof thread.preview === 'string' && thread.preview.trim() ? thread.preview.slice(0, 100) : 'Untitled Codex session', harnessLabel: 'Codex', timestamp, open: false, status: 'closed' as const, keywords: thread.id };
    }) };
  }
  async dispose(): Promise<void> { this.disposed = true; this.client?.disconnect('Project closed'); await this.stop(); }
}
