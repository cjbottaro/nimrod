import { CodexClient, type CodexInteractionFailure } from './client';
import type { CodexTransport, CodexDeletionControl } from './native';
import { codexDeletionTree, CodexMissingDeletionRoot, MAX_CODEX_INVENTORY, type CodexDeletionTree } from './deletion-tree';
import type { CodexThread } from './protocol';
import { abortable, type SessionHistory, type SessionHistoryPage } from '../session-history';
import { ownedSessionStop } from '../session-lifecycle';
import { savedSessionKey } from '../session-list';
import type { TranscriptLogSink } from '../transcript-logs';
export const codexHistoryKey = (cwd: string) => `nimrod.history.codex.v1:${cwd}`;
export interface CodexHistoryDiagnostics {
  transcriptLog?: TranscriptLogSink;
  interactionFailure?(failure: CodexInteractionFailure): void;
}
/** Discovery has its own owned process and never binds or prompts a conversation. */
export class CodexSessionHistory implements SessionHistory {
  readonly id = 'codex'; readonly label = 'Codex';
  private owner: { token?: string } = {};
  private client?: CodexClient;
  private initializing?: Promise<void>;
  private launching?: Promise<string>;
  private disposed = false;
  private deleting = false;
  private cleanupFailed = false;
  private confirmed?: (id: string) => void;
  get supportsDeletion(): boolean { return !this.disposed && !this.cleanupFailed && !!this.host.deletion; }
  private stop: () => Promise<void>;
  constructor(private cwd: string, private host: CodexTransport & { deletion?: CodexDeletionControl }, private error: (error: unknown) => void, private diagnostics: CodexHistoryDiagnostics = {}) {
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
    const client = this.client = new CodexClient({ write: packet => { this.capture(typeof packet.method === 'string' ? 'catalog.request' : 'catalog.response', packet, token); return this.host.write(token, packet); } }, { disconnected: error => {
      const reportDiscoveryFailure = !this.disposed && !this.deleting;
      if (reportDiscoveryFailure) this.error(error);
      void this.stop().catch(error => { if (reportDiscoveryFailure && !this.disposed) this.error(error); });
    }, deleted: id => this.confirmed?.(id), interactionFailure: failure => {
      this.capture('catalog.interaction.rejected', failure, token);
      if (!this.disposed) {
        if (this.diagnostics.interactionFailure) this.diagnostics.interactionFailure(failure);
        else this.error(`Codex catalog interaction ${failure.method} (request ${failure.requestId}) could not be handled: ${failure.reason}. No answer or approval was supplied.`);
      }
    } });
    try {
      this.launching = this.host.start(token, packet => { this.capture('catalog.receive', packet, token); client.receive(packet); }, reason => client.disconnect(reason));
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
  async retention(sessionId: string): Promise<'saved' | 'absent'> {
    return await this.inspectTree(sessionId, new AbortController().signal) ? 'saved' : 'absent';
  }
  async previewTree(rootId: string, signal: AbortSignal): Promise<CodexDeletionTree | null> {
    if (this.deleting && this.client?.phase !== 'ready') throw new Error('Codex deletion catalog disconnected. Nothing was retried.');
    this.deleting = true;
    return this.inspectTree(rootId, signal);
  }
  private async inspectTree(rootId: string, signal: AbortSignal): Promise<CodexDeletionTree | null> {
    await abortable(this.initialize(), signal);
    const inventory: CodexThread[] = [];
    for (const archived of [false, true]) {
      const cursors = new Set<string>(); let cursor: string | undefined;
      do {
        signal.throwIfAborted();
        const page = await abortable(this.client!.deletionInventory(archived, cursor), signal);
        for (const thread of page.data) inventory.push(thread);
        if (inventory.length > MAX_CODEX_INVENTORY) throw new Error('Codex deletion inventory exceeds 100,000 threads');
        cursor = page.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error('Codex deletion inventory repeated a cursor. Nothing was deleted.');
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    signal.throwIfAborted();
    if (!inventory.some(thread => thread.id === rootId)) {
      // Named zero-message histories may be saved but excluded from thread/list.
      const saved = await abortable(this.client!.readSavedThread(rootId, this.cwd), signal);
      signal.throwIfAborted();
      if (saved) {
        inventory.push(saved);
        if (inventory.length > MAX_CODEX_INVENTORY) throw new Error('Codex deletion inventory exceeds 100,000 threads');
      } else {
        try { codexDeletionTree(this.cwd, rootId, inventory); }
        catch (error) {
          if (error instanceof CodexMissingDeletionRoot) return null;
          throw error;
        }
        throw new Error('Codex absence lookup conflicted with its deletion inventory');
      }
    }
    return codexDeletionTree(this.cwd, rootId, inventory);
  }
  async reserveDeletion(operationId: string, rootId: string, ids: readonly string[]): Promise<void> {
    if (!this.supportsDeletion || !this.owner.token) throw new Error('Codex deletion is unavailable');
    await this.host.deletion!.reserve(this.owner.token, operationId, rootId, ids);
  }
  async reserveLocalRemoval(operationId: string, rootId: string): Promise<void> {
    if (!this.supportsDeletion || !this.owner.token) throw new Error('Codex local removal is unavailable');
    await this.host.deletion!.reserve(this.owner.token, operationId, rootId, [rootId], true);
  }
  async stopDeletionOwners(operationId: string): Promise<void> {
    if (!this.owner.token || !this.host.deletion) throw new Error('Codex deletion ownership is unavailable');
    await this.host.deletion.stop(this.owner.token, operationId);
  }
  async deleteTree(rootId: string, confirmed: (id: string) => void): Promise<void> {
    if (!this.client || this.client.phase !== 'ready') throw new Error('Codex deletion catalog is unavailable. Nothing was retried.');
    this.confirmed = confirmed;
    try { await this.client.deleteThread(rootId); } finally { this.confirmed = undefined; }
  }
  async finishDeletion(operationId: string, uncertain: boolean): Promise<void> {
    try {
      if (uncertain) { this.client?.disconnect('Codex deletion outcome is unconfirmed; retire its owned server before releasing guards'); await this.stop(); }
      if (this.owner.token && this.host.deletion) await this.host.deletion.release(this.owner.token, operationId);
    } catch (error) { this.cleanupFailed = true; throw new Error(`Codex deletion cleanup was not confirmed; native guards remain reserved. ${String(error)}`); }
    finally { this.deleting = false; this.confirmed = undefined; }
  }
  private capture(event: string, payload: unknown, token: string): void {
    if (this.diagnostics.transcriptLog?.enabled) this.diagnostics.transcriptLog.append({ source: { backend: 'codex', agent: 'codex' }, sessionId: `catalog:${token}`, connectionId: token, event, payload });
  }
  async dispose(): Promise<void> { this.disposed = true; this.client?.disconnect('Project closed'); await this.stop(); }
}
