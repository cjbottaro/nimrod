import { CopilotConnection, record, type BridgeRequest } from './connection';
import { abortable, type SessionHistory, type SessionHistoryPage } from '../session-history';
import { ownedSessionStop } from '../session-lifecycle';
import { savedSessionKey } from '../session-list';
export const copilotHistoryKey = (cwd: string) => `nimrod.history.copilot-sdk.v1:${cwd}`;
interface Host {
  start(token: string, receive: (packet: unknown) => void, disconnected: (message: string) => void): Promise<string>;
  send(token: string, message: BridgeRequest): Promise<void>;
  stop(token: string): Promise<void>;
  error(error: unknown): void;
}
/** A discovery-only SDK client, never a controller of a conversation. */
export class CopilotSessionHistory implements SessionHistory {
  readonly id = 'copilot-sdk';
  readonly label = 'Copilot';
  private owner: { token?: string } = {};
  private connection?: CopilotConnection;
  private initializing?: Promise<void>;
  private launching?: Promise<string>;
  private disposed = false;
  private ready = false;
  private deleting = false;
  private stop: () => Promise<void>;
  get supportsDeletion(): boolean { return this.ready && !this.disposed; }
  constructor(private cwd: string, private host: Host) {
    this.stop = ownedSessionStop(() => this.owner, token => this.launching ? this.launching.then(() => host.stop(token), () => host.stop(token)) : host.stop(token));
  }
  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('Copilot history is closed');
    if (this.ready) return;
    if (this.initializing) return this.initializing;
    const task = this.start(); this.initializing = task;
    try { await task; } finally { if (this.initializing === task) this.initializing = undefined; }
  }
  private async start(): Promise<void> {
    await this.stop();
    if (this.disposed) throw new Error('Copilot history is closed');
    const token = crypto.randomUUID(); this.owner.token = token;
    const connection = this.connection = new CopilotConnection(message => this.host.send(token, message), () => { throw new Error('Unexpected conversation event on Copilot history connection'); }, reason => {
      this.ready = false;
      if (!this.disposed && !this.deleting) this.host.error(reason);
      void this.stop().catch(error => this.host.error(error));
    });
    try {
      this.launching = this.host.start(token, packet => connection.receive(packet), reason => connection.disconnect(reason));
      const confirmed = await this.launching;
      if (this.disposed || confirmed !== this.cwd) throw new Error('Copilot history project was not confirmed');
      await connection.request('initialize'); this.ready = true;
    } catch (error) { connection.disconnect(String(error)); await this.stop(); throw error; }
  }
  async list({ signal, cursor }: { signal: AbortSignal; cursor?: string }): Promise<SessionHistoryPage> {
    if (cursor !== undefined) throw new Error('Copilot SDK listing does not use pagination');
    signal.throwIfAborted();
    await abortable(this.initialize(), signal);
    const result = await abortable(this.connection!.request('list'), signal);
    signal.throwIfAborted();
    if (!Array.isArray(result)) throw new Error('Invalid Copilot SDK history response');
    return { warnings: [], entries: result.map(value => {
      if (!record(value) || typeof value.sessionId !== 'string' || !value.sessionId || !record(value.context) || value.context.workingDirectory !== this.cwd || value.isRemote !== false)
        throw new Error('Invalid or cross-project Copilot SDK history entry');
      const reference = { kind: 'copilot-sdk' as const, sessionId: value.sessionId };
      const timestamp = typeof value.modifiedTime === 'string' ? Date.parse(value.modifiedTime) : NaN;
      return { key: savedSessionKey(reference), reference, title: typeof value.summary === 'string' && value.summary.trim() ? value.summary : 'Untitled Copilot session',
        harnessLabel: 'Copilot', timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined, open: false, status: 'closed' as const, keywords: value.sessionId };
    }) };
  }
  async validateDeletion(sessionId: string): Promise<void> {
    const page = await this.list({ signal: new AbortController().signal });
    if (!page.entries.some(entry => entry.reference?.sessionId === sessionId)) throw new Error('This Copilot session is no longer listed in this project. Nothing was deleted.');
  }
  async deleteSession(sessionId: string): Promise<void> {
    this.deleting = true;
    try {
      await this.validateDeletion(sessionId);
      await this.connection!.request('delete', { sessionId });
    } catch (error) {
      this.connection?.disconnect(`Copilot deletion was not confirmed: ${String(error)}`);
      throw new Error(`Copilot deletion was not confirmed: ${String(error)}. Nimrod retains the saved identity and draft. Nothing was retried. Refresh history to verify the outcome before another explicit attempt.`);
    } finally { this.deleting = false; }
  }
  async dispose(): Promise<void> { this.disposed = true; this.ready = false; this.connection?.disconnect('Project closed'); await this.stop(); }
}
