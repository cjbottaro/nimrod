import { AcpClient } from './client';
import { AcpConnectionError, type AcpPacket } from './connection';
import { abortable, type SessionHistory, type SessionHistoryPage } from '../session-history';
import { savedSessionKey, type SessionListEntry } from '../session-list';
import { ownedSessionStop } from '../session-lifecycle';
import { lastUsed } from '../session-recency';

export const copilotHistoryKey = (cwd: string) => `nimrod.history.copilot.v1:${cwd}`;

export interface CopilotHistoryHost {
  start(token: string, receive: (packet: unknown) => void, disconnected: (message: string) => void): Promise<string>;
  send(token: string, packet: AcpPacket): Promise<void>;
  stop(token: string): Promise<void>;
  error(error: unknown): void;
}

/** One project-owned discovery connection; never a controller of a conversation. */
export class CopilotSessionHistory implements SessionHistory {
  readonly id = 'copilot';
  readonly label = 'Copilot';
  private owner: { token?: string } = {};
  private client?: AcpClient;
  private initializing?: Promise<void>;
  private launching?: Promise<string>;
  private disposed = false;
  private stop: () => Promise<void>;

  constructor(private cwd: string, private host: CopilotHistoryHost) {
    this.stop = ownedSessionStop(() => this.owner, token => {
      const stop = () => host.stop(token);
      // Observe a late launch before stopping. Its failure is reported by start().
      return this.launching ? this.launching.then(stop, stop) : stop();
    });
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('Copilot history source is closed');
    if (this.initializing) return this.initializing;
    if (this.client?.phase === 'ready') return;
    const task = this.start();
    this.initializing = task;
    try { await task; }
    finally { if (this.initializing === task) this.initializing = undefined; }
  }

  private async start(): Promise<void> {
    await this.stop();
    if (this.disposed) throw new Error('Copilot history source is closed');
    const token = crypto.randomUUID();
    this.owner.token = token;
    const client = this.client = new AcpClient(packet => this.host.send(token, packet), {
      disconnected: error => {
        if (!this.disposed) this.host.error(error);
        void this.stop().catch(error => this.host.error(error));
      },
    });
    try {
      const confirmed = await (this.launching = Promise.resolve().then(() =>
        this.host.start(token, packet => client.receive(packet), message => client.disconnect(message))));
      if (this.disposed || client.phase === 'disconnected') throw new Error('Copilot history connection was closed');
      if (confirmed !== this.cwd) throw new Error('Native ACP host did not confirm the history project');
      await this.deadline(client.initialize(), client);
    } catch (error) {
      client.disconnect(error);
      await this.stop();
      throw error;
    }
  }

  async list({ signal, cursor }: { signal: AbortSignal; cursor?: string }): Promise<SessionHistoryPage> {
    signal.throwIfAborted();
    await abortable(this.initialize(), signal);
    signal.throwIfAborted();
    const client = this.client;
    if (!client) throw new Error('Copilot history connection is unavailable');
    const page = await abortable(this.deadline(client.listSessions(this.cwd, cursor), client), signal);
    signal.throwIfAborted();
    return {
      warnings: [], nextCursor: page.nextCursor,
      entries: page.sessions.filter(session => session.cwd === this.cwd).map<SessionListEntry>(session => {
        const reference = { kind: 'acp' as const, profile: 'copilot' as const, sessionId: session.sessionId };
        return {
          key: savedSessionKey(reference), reference, title: session.title?.trim() || 'Untitled Copilot session',
          harnessLabel: 'Copilot ACP', timestamp: session.updatedAt ? lastUsed(Date.parse(session.updatedAt)) || undefined : undefined,
          status: 'closed', open: false, keywords: session.sessionId,
        };
      }),
    };
  }

  private async deadline<T>(task: Promise<T>, client: AcpClient): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new AcpConnectionError('Copilot history request timed out. Use Refresh to retry.');
        client.disconnect(error); reject(error);
      }, 20_000);
    });
    try { return await Promise.race([task, timeout]); }
    finally { clearTimeout(timer); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.client?.disconnect('Project closed');
    await this.stop();
  }
}
