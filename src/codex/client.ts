import { mcpServer, terminal, projectEntry } from './command-reports';
import { codexQuestionRequest, codexQuestionAnswers, type CodexQuestionRequest, type CodexQuestionAnswers } from './questions';
import type { ImageContent } from '../image-attachments';
import packageInfo from '../../package.json';
import { JsonRpcConnection, RpcConnectionError, RpcResponseError, isRecord, isRpcId, type RpcId, type RpcRecord } from '../json-rpc-connection';
import { item, nonempty, page, record, thread, turn, type CodexApproval, type CodexApprovalDecision, type CodexEvent,
  type CodexItemEntry, type CodexPacket, type CodexPage, type CodexPhase, type CodexThread, type CodexTurn } from './protocol';

/** Native host supplies ordered writes and calls receive with ordered decoded records.
 * Framing/size bounds, daemon discovery and observed client teardown are NOT this port.
 */
export interface CodexWriter {
  write(packet: CodexPacket): void | Promise<void>;
  /** Native, token-scoped filesystem verification, for runtime paths only. Never history membership. */
  runtimeCwdMatches?(actual: string, project: string): boolean;
}
export interface CodexInteractionFailure { method: string; requestId: RpcId; reason: string; }
export interface CodexClientHooks {
  /** Identity validation and draft binding must finish synchronously before replay/publication. */
  identified?(thread: CodexThread, settings: Readonly<RpcRecord>): void;
  event?(event: CodexEvent): void;
  /** Catalog deletion notifications are authoritative even without a bound conversation. */
  deleted?(threadId: string): void;
  /** Remains pending on modal dismissal. Owner retirement/resolution aborts the signal. */
  approval?(request: CodexApproval, signal: AbortSignal): Promise<CodexApprovalDecision>;
  question?(request: CodexQuestionRequest, signal: AbortSignal): Promise<CodexQuestionAnswers | undefined>;
  interactionFailure?(failure: CodexInteractionFailure): void;
  disconnected?(error: RpcConnectionError): void;
}
interface CompactAttempt {
  turnId?: string; compacted: boolean; error?: string;
  finish(outcome: { error?: Error }): void;
}
export class CodexCompactionUncertain extends Error {}
interface StartingTurn { observedId?: string; completed?: boolean; }
const MAX_EARLY_EVENTS = 128;
const MAX_EARLY_BYTES = 1024 * 1024;

/** One app-server connection, at most one bound thread. No retry, reset or prompt replay.
 * This is a concrete Codex owner, not the common interface implemented by other harnesses.
 */
export class CodexClient {
  private readonly connection: JsonRpcConnection;
  private state: CodexPhase = 'new';
  private bound?: CodexThread;
  private projectCwd?: string;
  private currentTurn?: { id: string; completed: boolean };
  private startingTurn?: StartingTurn;
  private compactAttempt?: CompactAttempt;
  private configurationAttempt?: { setting: 'model' | 'effort'; value: string; confirmed: boolean; finish(outcome: { settings?: RpcRecord; error?: Error }): void };
  private early: CodexEvent[] = [];
  private earlyBytes = 0;
  private earlyRequestCount = 0;
  private earlyRequestBytes = 0;
  private openingReady?: { promise: Promise<void>; resolve(): void };
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly decisions = new Map<RpcId, { turnId: string; controller: AbortController }>();

  constructor(private writer: CodexWriter, private hooks: CodexClientHooks = {}, private timeoutMs = 20_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Codex timeout must be positive');
    this.connection = new JsonRpcConnection(packet => writer.write(packet), {
      notification: (method, params) => this.notification(method, params),
      request: (method, params, signal, id) => this.request(method, params, signal, id),
      disconnected: error => {
        this.compactAttempt?.finish({ error });
        this.configurationAttempt?.finish({ error });
        this.state = 'disconnected'; this.early = []; this.earlyBytes = 0;
        this.openingReady?.resolve();
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        for (const decision of this.decisions.values()) decision.controller.abort();
        this.decisions.clear();
        hooks.disconnected?.(error);
      },
    }, { label: 'Codex', versionMember: false });
  }
  private runtimeCwdMatches(actual: unknown): boolean {
    return typeof actual === 'string' && this.projectCwd !== undefined
      && (actual === this.projectCwd || this.writer.runtimeCwdMatches?.(actual, this.projectCwd) === true);
  }
  get phase(): CodexPhase { return this.state; }
  get threadId(): string | undefined { return this.bound?.id; }
  get activeTurnId(): string | undefined { return this.state !== 'working' || this.currentTurn?.completed ? undefined : this.currentTurn?.id; }
  get compacting(): boolean { return !!this.compactAttempt; }
  receive(packet: unknown): void { this.connection.receive(packet); }
  disconnect(reason?: unknown): void { this.connection.disconnect(reason); }

  async rename(name: string, applied: () => void): Promise<void> {
    const threadId = this.requireBound();
    await this.rpc('thread/name/set', { threadId, name }, value => {
      record(value, 'rename response'); applied();
    });
  }

  async readBoundThread(): Promise<CodexThread> {
    const threadId = this.requireBound(); let result!: CodexThread;
    await this.rpc('thread/read', { threadId, includeTurns: false }, value => {
      result = thread(record(value, 'thread read').thread);
      if (result.id !== threadId || !this.runtimeCwdMatches(result.cwd)) throw new Error('Codex report returned a conflicting thread or project');
      for (const field of ['name', 'model', 'reasoningEffort']) if (result[field] != null && typeof result[field] !== 'string') throw new Error(`Invalid Codex thread report ${field}`);
    });
    return result;
  }
  /** Unbound catalog lookup: distinguish native absence from filtered listing.
   * Never creates/resumes a thread or materializes history via includeTurns.
   */
  async readSavedThread(threadId: string, cwd: string): Promise<CodexThread | null> {
    if (this.state !== 'ready') throw new Error('Saved-thread lookup requires an unbound Codex catalog');
    nonempty(threadId, 'saved thread ID'); nonempty(cwd, 'project cwd');
    let result!: CodexThread;
    try {
      await this.rpc('thread/read', { threadId, includeTurns: false }, value => {
        result = thread(record(value, 'saved thread read').thread);
        if (result.id !== threadId || result.cwd !== cwd || result.ephemeral)
          throw new Error('Codex saved-thread lookup returned a conflicting identity, project or persistence state');
      });
    } catch (error) {
      // This exact native read response is not a timeout, arbitrary Resume
      // failure, empty transcript or missing thread/list entry.
      if (error instanceof RpcResponseError && error.code === -32600 && error.message === `thread not loaded: ${threadId}`) return null;
      throw error;
    }
    return result;
  }
  async mcpServers(verbose: boolean, cursor?: string): Promise<CodexPage<RpcRecord>> {
    const threadId = this.requireBound(); let result!: CodexPage<RpcRecord>;
    await this.rpc('mcpServerStatus/list', { threadId, limit: 100, detail: verbose ? 'full' : 'toolsAndAuthOnly', ...(cursor ? { cursor } : {}) }, value => { result = page(value, mcpServer); });
    return result;
  }
  async backgroundTerminals(cursor?: string): Promise<CodexPage<RpcRecord>> {
    const threadId = this.requireBound(); let result!: CodexPage<RpcRecord>;
    await this.rpc('thread/backgroundTerminals/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) }, value => { result = page(value, terminal); });
    return result;
  }
  async projectCatalog(kind: 'skills' | 'hooks'): Promise<RpcRecord> {
    this.requireBound(); const cwd = this.projectCwd!; let result!: RpcRecord;
    await this.rpc(`${kind}/list`, { cwds: [cwd] }, value => { result = projectEntry(value, cwd, kind); });
    return result;
  }
  /** Compact acknowledgement only enqueues Op::Compact. Wait for its native
   * turn, a canonical contextCompaction item and terminal outcome, in either
   * response/event order. No hidden turn/start, polling or compaction replay.
   */
  async compact(): Promise<void> {
    if (this.state !== 'idle' || !this.bound || this.compactAttempt) throw new Error('Codex compaction requires an idle thread');
    let finish!: CompactAttempt['finish'];
    const completion = new Promise<{ error?: Error }>(resolve => { finish = resolve; });
    const attempt: CompactAttempt = { compacted: false, finish };
    this.compactAttempt = attempt; this.state = 'working'; this.currentTurn = undefined;
    try {
      await this.rpc('thread/compact/start', { threadId: this.bound.id }, value => { record(value, 'compact response'); });
      const outcome = await completion;
      if (outcome.error) throw outcome.error;
    } catch (error) {
      if (error instanceof RpcResponseError && !attempt.turnId && this.phase !== 'disconnected') this.state = 'idle';
      else if (error instanceof RpcResponseError && attempt.turnId) {
        const uncertain = new CodexCompactionUncertain('Codex rejected compaction after reporting its turn. Its outcome is inconsistent; nothing was retried.');
        this.disconnect(uncertain); throw uncertain;
      } else if (error instanceof CodexCompactionUncertain) this.disconnect(error);
      throw error;
    } finally { if (this.compactAttempt === attempt) this.compactAttempt = undefined; }
  }

  async initialize(): Promise<void> {
    if (this.state !== 'new') throw new Error('Codex initialization is unavailable');
    this.state = 'initializing';
    try {
      await this.rpc('initialize', { clientInfo: { name: 'nimrod', title: 'Nimrod', version: packageInfo.version },
        capabilities: { experimentalApi: true, requestAttestation: false } }, value => {
        const result = record(value, 'initialization'); nonempty(result.userAgent, 'user agent');
        // Send in the ordered response callback, not a continuation after later wire events.
        this.connection.notify('initialized', {}); this.state = 'ready';
      });
    } catch (error) { this.disconnect(error); throw error; }
  }

  /** Opens an exact-project, non-ephemeral thread. A start ID is not durable-save evidence. Never starts provider work. */
  async open(cwd: string, savedThreadId?: string): Promise<CodexThread> {
    if (this.state !== 'ready') throw new Error('Codex thread opening is unavailable');
    nonempty(cwd, 'project cwd');
    if (savedThreadId !== undefined) nonempty(savedThreadId, 'saved thread ID');
    this.projectCwd = cwd;
    this.state = 'opening';
    let resolve!: () => void;
    this.openingReady = { promise: new Promise<void>(ready => { resolve = ready; }), resolve: () => resolve() };
    let opened!: CodexThread;
    try {
      if (savedThreadId !== undefined) {
        // Codex's cwd-filtered listing can canonicalize aliases and rewrite row cwd.
        // Verify the exact saved metadata before attaching to any runtime.
        await this.rpc('thread/read', { threadId: savedThreadId, includeTurns: false }, value => {
          const saved = thread(record(value, 'saved project read').thread);
          if (saved.id !== savedThreadId || saved.cwd !== cwd || saved.ephemeral)
            throw new Error(`Codex saved project mismatch: expected ${JSON.stringify(cwd)}, received ${JSON.stringify(saved.cwd)} (thread ${saved.id})`);
        });
      }
      await this.rpc(savedThreadId === undefined ? 'thread/start' : 'thread/resume',
        savedThreadId === undefined ? { cwd, ephemeral: false } : { threadId: savedThreadId, cwd, excludeTurns: true }, value => {
          const result = record(value, 'thread response'); const candidate = thread(result.thread);
          const candidateMatches = savedThreadId === undefined ? candidate.cwd === cwd : this.runtimeCwdMatches(candidate.cwd);
          if (!candidateMatches || !this.runtimeCwdMatches(result.cwd) || candidate.ephemeral || savedThreadId !== undefined && candidate.id !== savedThreadId)
            throw new Error(`Codex returned a conflicting thread identity or project: expected ${JSON.stringify(cwd)}, thread cwd ${JSON.stringify(candidate.cwd)}, runtime cwd ${JSON.stringify(result.cwd)}`);
          const active = candidate.turns.filter(entry => entry.status === 'inProgress');
          if (active.length > 1) throw new Error('Codex returned multiple active turns');
          const status = candidate.status.type;
          if (status !== 'idle' && status !== 'active') throw new Error('Codex did not open a usable thread');
          // Bind only fully validated identity/state, before buffered events or continuations.
          this.hooks.identified?.(candidate, result);
          if (!this.connection.connected) throw new RpcConnectionError('Codex identity binding was retired');
          this.bound = opened = candidate;
          if (active[0]) this.currentTurn = { id: active[0].id, completed: false };
          // A paginated live resume may have no turn payload. Remain busy until an
          // explicit turn event supplies identity; never invent one for steering/Stop.
          this.state = active.length || status === 'active' ? 'working' : 'idle';
          const buffered = this.early; this.early = []; this.earlyBytes = 0;
          for (const event of buffered) this.notification(event.method, event.params);
        });
      return opened;
    } catch (error) { this.disconnect(error); throw error; }
    finally { this.openingReady?.resolve(); this.openingReady = undefined; }
  }

  async startTurn(text: string, clientUserMessageId: string, images: readonly ImageContent[] = []): Promise<void> {
    if (this.state !== 'idle' || !this.bound) throw new Error('Codex is not idle');
    if (!images.length) nonempty(text, 'prompt'); nonempty(clientUserMessageId, 'client message ID');
    const attempt: StartingTurn = {};
    this.startingTurn = attempt; this.state = 'working'; this.currentTurn = undefined;
    try {
      await this.rpc('turn/start', { threadId: this.bound.id, clientUserMessageId, input: [...(text ? [{ type: 'text', text, text_elements: [] }] : []), ...images.map(image => ({ type: 'image', url: `data:${image.mimeType};base64,${image.data}` }))] }, value => {
        const result = turn(record(value, 'turn response').turn);
        if (attempt.observedId && attempt.observedId !== result.id) throw new Error('Codex returned a conflicting turn ID');
        // A completion notification can precede this response. An older response
        // must not resurrect a completed turn or overwrite newer streamed items.
        if (!attempt.completed) this.applyTurn(result);
      });
    } catch (error) {
      if (error instanceof RpcResponseError && !attempt.observedId && this.phase !== 'disconnected') this.state = 'idle';
      else { this.disconnect(error); throw new RpcConnectionError(`Codex turn delivery was not confirmed: ${String(error)}. Nothing was replayed.`); }
      throw error;
    } finally { if (this.startingTurn === attempt) this.startingTurn = undefined; }
  }

  async steer(text: string, clientUserMessageId: string): Promise<void> {
    const turnId = this.activeTurnId;
    if (this.state !== 'working' || !this.bound || !turnId) throw new Error('Codex has no identified active turn to steer');
    nonempty(text, 'steering input'); nonempty(clientUserMessageId, 'client message ID');
    await this.rpc('turn/steer', { threadId: this.bound.id, expectedTurnId: turnId, clientUserMessageId,
      input: [{ type: 'text', text, text_elements: [] }] }, value => {
      if (record(value, 'steering response').turnId !== turnId) throw new Error('Codex returned a conflicting steering turn');
    });
  }

  /** Acknowledgement is NOT turn completion. Wait for the authoritative notification. */
  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!this.bound || this.state !== 'working' || !turnId) throw new Error('Codex has no identified active turn to interrupt');
    await this.rpc('turn/interrupt', { threadId: this.bound.id, turnId }, value => { record(value, 'interrupt response'); });
  }

  /** Discovery is project-bound and does not create/resume a thread or send a prompt. */
  async listThreads(cwd: string, cursor?: string): Promise<CodexPage<CodexThread>> {
    if (this.state !== 'ready') throw new Error('Codex discovery requires an unbound initialized connection');
    nonempty(cwd, 'project cwd'); if (cursor !== undefined) nonempty(cursor, 'history cursor');
    let result!: CodexPage<CodexThread>;
    await this.rpc('thread/list', { ...(cursor === undefined ? {} : { cursor }), limit: 100, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], sourceKinds: ['cli', 'vscode', 'appServer'], archived: false }, value => {
      const decoded = page(value, thread);
      // Do not send cwd: the daemon normalizes its filter and can rewrite returned cwd.
      // Unfiltered metadata preserves the saved project spelling; partition it exactly here.
      result = { ...decoded, data: decoded.data.filter(entry => entry.cwd === cwd && !entry.ephemeral && entry.parentThreadId == null) };
    });
    return result;
  }

  /** Complete source/archive inventory for deletion only; no project filtering can hide descendants. */
  async deletionInventory(archived: boolean, cursor?: string): Promise<CodexPage<CodexThread>> {
    if (this.state !== 'ready') throw new Error('Codex deletion discovery requires an unbound catalog');
    if (cursor !== undefined) nonempty(cursor, 'deletion cursor');
    let result!: CodexPage<CodexThread>;
    await this.rpc('thread/list', { archived, sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'],
      modelProviders: [], limit: 100, sortKey: 'created_at', sortDirection: 'asc', ...(cursor === undefined ? {} : { cursor }) }, value => { result = page(value, thread); });
    return result;
  }
  async deleteThread(rootId: string): Promise<void> {
    if (this.state !== 'ready') throw new Error('Codex deletion requires an unbound catalog');
    nonempty(rootId, 'deletion root');
    await this.rpc('thread/delete', { threadId: rootId }, value => {
      if (Object.keys(record(value, 'deletion acknowledgement')).length) throw new Error('Invalid Codex deletion acknowledgement');
    });
  }

  /** Separate pages are deliberate: a resume response is not a complete transcript. */
  async listTurns(cursor?: string): Promise<CodexPage<CodexTurn>> {
    const threadId = this.requireBound(); if (cursor !== undefined) nonempty(cursor, 'turn cursor');
    let result!: CodexPage<CodexTurn>;
    await this.rpc('thread/turns/list', { threadId, sortDirection: 'asc', itemsView: 'full', limit: 100, ...(cursor === undefined ? {} : { cursor }) }, value => { result = page(value, turn); });
    return result;
  }
  async listItems(turnId: string, cursor?: string): Promise<CodexPage<CodexItemEntry>> {
    const threadId = this.requireBound(); nonempty(turnId, 'history turn ID'); if (cursor !== undefined) nonempty(cursor, 'item cursor');
    let result!: CodexPage<CodexItemEntry>;
    await this.rpc('thread/items/list', { threadId, turnId, sortDirection: 'asc', limit: 100, ...(cursor === undefined ? {} : { cursor }) }, value => {
      result = page(value, entry => {
        const decoded = record(entry, 'item entry');
        if (decoded.turnId !== turnId) throw new Error('Codex returned an item from another turn');
        item(decoded.item); return decoded as CodexItemEntry;
      });
    });
    return result;
  }
  /** Update the live thread, including before its first saved rollout. The empty
   * acknowledgement alone is not effective-state evidence: await native settings
   * in either response/event order. Never resume, submit a turn or retry.
   */
  async configure(cwd: string, setting: 'model' | 'effort', value: string): Promise<RpcRecord> {
    if (this.state !== 'idle' || this.configurationAttempt) throw new Error('Codex configuration requires idle');
    const threadId = this.requireBound(); nonempty(value, 'configuration value');
    if (cwd !== this.projectCwd) throw new Error('Codex configuration project does not match the bound thread');
    let finish!: (outcome: { settings?: RpcRecord; error?: Error }) => void;
    const confirmation = new Promise<{ settings?: RpcRecord; error?: Error }>(resolve => { finish = resolve; });
    const attempt = { setting, value, finish, confirmed: false };
    this.configurationAttempt = attempt;
    const timer = setTimeout(() => this.disconnect('Codex settings confirmation timed out. Nothing was retried.'), this.timeoutMs);
    this.timers.add(timer);
    try {
      await this.rpc('thread/settings/update', { threadId, [setting]: value }, data => {
        if (Object.keys(record(data, 'configuration acknowledgement')).length)
          throw new Error('Invalid Codex configuration acknowledgement');
      });
      const outcome = await confirmation;
      if (outcome.error) throw outcome.error;
      return outcome.settings!;
    } catch (error) {
      // A settings event followed by a rejection is contradictory, not a safe failure.
      if (error instanceof RpcResponseError && attempt.confirmed) this.disconnect(error);
      throw error;
    } finally {
      clearTimeout(timer); this.timers.delete(timer);
      if (this.configurationAttempt === attempt) this.configurationAttempt = undefined;
    }
  }
  async models(cursor?: string): Promise<CodexPage<RpcRecord>> {
    if (!['ready', 'idle', 'working'].includes(this.state)) throw new Error('Codex model catalog unavailable');
    let result!: CodexPage<RpcRecord>;
    await this.rpc('model/list', { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) }, data => {
      result = page(data, value => {
        const model = record(value, 'model');
        nonempty(model.model, 'model ID'); nonempty(model.displayName, 'model name');
        if (!Array.isArray(model.supportedReasoningEfforts) || !Array.isArray(model.inputModalities)) throw new Error('Invalid Codex model capabilities');
        return model;
      });
    });
    return result;
  }
  /** Only hydrate an unknown live ID; never let a history snapshot overwrite observed events. */
  recoverActiveTurn(value: CodexTurn): void {
    if (this.state === 'working' && !this.currentTurn && !this.startingTurn && value.status === 'inProgress')
      this.currentTurn = { id: value.id, completed: false };
  }
  private requireBound(): string {
    if (!this.bound || !['idle', 'working'].includes(this.state)) throw new Error('Codex has no connected thread');
    return this.bound.id;
  }
  private rpc(method: string, params: RpcRecord, apply: (value: unknown) => void): Promise<unknown> {
    const timer = setTimeout(() => this.disconnect(`Codex ${method} timed out. Nothing was retried.`), this.timeoutMs);
    this.timers.add(timer);
    return this.connection.request(method, params, apply).finally(() => { clearTimeout(timer); this.timers.delete(timer); });
  }
  private notification(method: string, value: unknown): void {
    if (this.state === 'disconnected') return;
    const params = record(value ?? {}, 'notification parameters');
    if (this.state === 'opening' && !this.bound) {
      const bytes = new TextEncoder().encode(JSON.stringify(params)).byteLength;
      if (this.early.length + this.earlyRequestCount >= MAX_EARLY_EVENTS || this.earlyBytes + this.earlyRequestBytes + bytes > MAX_EARLY_BYTES) throw new Error('Codex pre-identity event buffer exceeded');
      this.early.push({ method, params }); this.earlyBytes += bytes; return;
    }
    if (method === 'thread/deleted') this.hooks.deleted?.(nonempty(params.threadId, 'deleted thread ID'));
    // App-server may report child-agent threads. They are not this conversation.
    const threadId = params.threadId ?? (isRecord(params.thread) ? params.thread.id : undefined);
    if (!this.bound || threadId !== this.bound.id) return;
    if (['thread/closed', 'thread/deleted', 'thread/archived'].includes(method)) { this.disconnect(`Codex reported ${method}. Saved identity and draft were retained.`); return; }
    const compact = this.compactAttempt;
    if (compact) {
      if (method === 'turn/started') {
        const native = turn(params.turn);
        if (compact.turnId && compact.turnId !== native.id) throw new Error('Codex compaction observed conflicting turns');
        compact.turnId = native.id;
      } else if (method === 'item/completed') {
        const native = item(params.item);
        if (native.type === 'contextCompaction' && params.turnId === compact.turnId) compact.compacted = true;
      } else if (method === 'error' && params.turnId === compact.turnId && params.willRetry !== true) {
        const error = record(params.error, 'compaction error');
        compact.error = typeof error.message === 'string' ? error.message : 'Codex reported a compaction error';
      } else if (method === 'turn/completed') {
        const native = turn(params.turn);
        if (native.id !== compact.turnId) throw new Error('Codex compaction completed an unidentified turn');
        if (native.items.some(entry => entry.type === 'contextCompaction')) compact.compacted = true;
        const terminalError = isRecord(native.error) && typeof native.error.message === 'string' ? native.error.message : undefined;
        const failure = compact.error || terminalError || (native.status === 'failed' ? 'Codex compaction failed' : native.status === 'interrupted' ? 'Codex compaction was interrupted' : undefined);
        compact.finish({ error: failure ? new Error(failure) : !compact.compacted
          ? new CodexCompactionUncertain('Codex completed a turn without confirming context compaction. Nothing was retried.') : undefined });
      }
    }
    if (method === 'thread/settings/updated' && this.configurationAttempt && !this.configurationAttempt.confirmed) {
      const settings = record(params.threadSettings, 'thread settings');
      const attempt = this.configurationAttempt;
      if (!this.runtimeCwdMatches(settings.cwd) || this.state !== 'idle' || settings[attempt.setting] !== attempt.value)
        throw new Error('Codex did not confirm the requested setting on this loaded thread');
      attempt.confirmed = true; attempt.finish({ settings });
    }
    if (method === 'serverRequest/resolved') {
      if (!isRpcId(params.requestId)) throw new Error('Invalid Codex resolved request ID');
      this.connection.cancelIncoming(params.requestId);
    } else if (method === 'turn/started' || method === 'turn/completed') {
      const next = turn(params.turn);
      if (method === 'turn/started' && next.status !== 'inProgress' || method === 'turn/completed' && next.status === 'inProgress') throw new Error('Invalid Codex turn lifecycle notification');
      if (this.startingTurn) {
        if (this.startingTurn.observedId && this.startingTurn.observedId !== next.id) throw new Error('Codex reported a conflicting pending turn');
        this.startingTurn.observedId = next.id;
        if (method === 'turn/completed') this.startingTurn.completed = true;
      }
      if (this.currentTurn && this.currentTurn.id !== next.id && !this.currentTurn.completed) throw new Error('Codex reported overlapping turns');
      this.applyTurn(next);
      if (method === 'turn/completed') this.abortTurnDecisions(next.id);
    }
    this.hooks.event?.({ method, params });
  }
  private applyTurn(value: CodexTurn): void {
    this.currentTurn = { id: value.id, completed: value.status !== 'inProgress' };
    this.state = value.status === 'inProgress' ? 'working' : 'idle';
  }
  private async request(method: string, value: unknown, signal: AbortSignal, id: RpcId): Promise<unknown> {
    // A shared daemon replays outstanding approvals/questions while Resume is opening.
    // Await validated identity; never reject another client's pending decision merely
    // because the response binding has not reached this ordered channel yet.
    if (this.state === 'opening' && !this.bound && this.openingReady) {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (this.early.length + this.earlyRequestCount >= MAX_EARLY_EVENTS || this.earlyBytes + this.earlyRequestBytes + bytes > MAX_EARLY_BYTES) {
        this.disconnect('Codex pre-identity request buffer exceeded');
        throw new RpcConnectionError('Codex pre-identity request buffer exceeded');
      }
      this.earlyRequestCount++; this.earlyRequestBytes += bytes;
      try { await this.openingReady.promise; }
      finally { this.earlyRequestCount--; this.earlyRequestBytes -= bytes; }
    }
    if (signal.aborted || !this.connection.connected) throw new RpcResponseError(-32800, 'Codex interaction is no longer pending');
    let pending: Promise<unknown>;
    try { pending = this.routeRequest(method, value, signal, id); }
    catch (error) { this.reportInteractionFailure(method, id, error); throw error; }
    return pending.catch(error => {
      if (!signal.aborted) this.reportInteractionFailure(method, id, error);
      throw error;
    });
  }
  private reportInteractionFailure(method: string, requestId: RpcId, error: unknown): void {
    this.hooks.interactionFailure?.({ method, requestId, reason: error instanceof Error ? error.message : String(error) });
  }
  private routeRequest(method: string, value: unknown, signal: AbortSignal, id: RpcId): Promise<unknown> {
    if (method === 'item/tool/requestUserInput') {
      const request = codexQuestionRequest(record(value, 'question request'));
      if (!this.hooks.question) throw new RpcResponseError(-32601, 'Codex questions are unavailable in this client');
      return this.ownedDecision(request, signal, id, abort => this.hooks.question!(request, abort)
        .then(answers => ({ answers: codexQuestionAnswers(request, answers) })));
    }
    if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval')
      throw new RpcResponseError(-32601, 'This Codex interaction method is not supported by Nimrod');
    const params = record(value, 'approval');
    if (!this.hooks.approval) throw new RpcResponseError(-32601, 'Codex approvals are unavailable');
    return this.ownedDecision(params, signal, id, abort => this.hooks.approval!({
      kind: method === 'item/commandExecution/requestApproval' ? 'command' : 'fileChange',
      threadId: params.threadId as string, turnId: params.turnId as string, itemId: params.itemId as string, native: params,
    }, abort).then(decision => {
      if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) throw new RpcResponseError(-32602, 'Unsupported Codex approval decision');
      return { decision };
    }));
  }
  /** Shared callback ownership mechanics; question/approval schemas remain concrete above. */
  private ownedDecision(params: { threadId?: unknown; turnId?: unknown; itemId?: unknown }, signal: AbortSignal, id: RpcId, run: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    // A live resume may provide active identity in its request before history hydrates.
    if (this.bound && params.threadId === this.bound.id && this.state === 'working' && !this.currentTurn && !this.startingTurn)
      this.currentTurn = { id: nonempty(params.turnId, 'decision turn ID'), completed: false };
    if (!this.bound || params.threadId !== this.bound.id || this.state !== 'working' || params.turnId !== this.activeTurnId)
      throw new RpcResponseError(-32602, 'Interaction does not belong to the active Nimrod thread and turn');
    nonempty(params.itemId, 'decision item ID');
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      if (this.decisions.get(id)?.controller === controller) this.decisions.delete(id);
    };
    signal.addEventListener('abort', abort, { once: true });
    this.decisions.set(id, { turnId: params.turnId as string, controller });
    let pending: Promise<unknown>;
    try { pending = run(controller.signal); } catch (error) { pending = Promise.reject(error); }
    return pending.then(result => {
      if (controller.signal.aborted) throw new RpcResponseError(-32800, 'Codex interaction is no longer pending');
      return result;
    }).finally(() => {
      signal.removeEventListener('abort', abort);
      if (this.decisions.get(id)?.controller === controller) this.decisions.delete(id);
    });
  }
  private abortTurnDecisions(turnId: string): void {
    for (const [id, decision] of this.decisions) if (decision.turnId === turnId) this.connection.cancelIncoming(id);
  }
}
