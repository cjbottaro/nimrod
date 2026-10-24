import type { ImageContent } from '../image-attachments';
import packageInfo from '../../package.json';
import { JsonRpcConnection, RpcConnectionError, RpcResponseError, isRecord, isRpcId, type RpcId, type RpcRecord } from '../json-rpc-connection';
import { item, nonempty, page, record, thread, turn, type CodexApproval, type CodexApprovalDecision, type CodexEvent,
  type CodexItemEntry, type CodexPacket, type CodexPage, type CodexPhase, type CodexThread, type CodexTurn } from './protocol';

/** Native host supplies ordered writes and calls receive with ordered decoded records.
 * Framing/size bounds, executable discovery and observed owned-process exit are NOT this port.
 */
export interface CodexWriter { write(packet: CodexPacket): void | Promise<void>; }
export interface CodexClientHooks {
  /** Identity validation and draft binding must finish synchronously before replay/publication. */
  identified?(thread: CodexThread, settings: Readonly<RpcRecord>): void;
  event?(event: CodexEvent): void;
  /** Remains pending on modal dismissal. Owner retirement/resolution aborts the signal. */
  approval?(request: CodexApproval, signal: AbortSignal): Promise<CodexApprovalDecision>;
  disconnected?(error: RpcConnectionError): void;
}
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
  private currentTurn?: { id: string; completed: boolean };
  private startingTurn?: StartingTurn;
  private early: CodexEvent[] = [];
  private earlyBytes = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly decisions = new Map<RpcId, { turnId: string; controller: AbortController }>();

  constructor(writer: CodexWriter, private hooks: CodexClientHooks = {}, private timeoutMs = 20_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Codex timeout must be positive');
    this.connection = new JsonRpcConnection(packet => writer.write(packet), {
      notification: (method, params) => this.notification(method, params),
      request: (method, params, signal, id) => this.request(method, params, signal, id),
      disconnected: error => {
        this.state = 'disconnected'; this.early = []; this.earlyBytes = 0;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        for (const decision of this.decisions.values()) decision.controller.abort();
        this.decisions.clear();
        hooks.disconnected?.(error);
      },
    }, { label: 'Codex', versionMember: false });
  }
  get phase(): CodexPhase { return this.state; }
  get threadId(): string | undefined { return this.bound?.id; }
  get activeTurnId(): string | undefined { return this.state !== 'working' || this.currentTurn?.completed ? undefined : this.currentTurn?.id; }
  receive(packet: unknown): void { this.connection.receive(packet); }
  disconnect(reason?: unknown): void { this.connection.disconnect(reason); }

  async initialize(): Promise<void> {
    if (this.state !== 'new') throw new Error('Codex initialization is unavailable');
    this.state = 'initializing';
    try {
      await this.rpc('initialize', { clientInfo: { name: 'nimrod', title: 'Nimrod', version: packageInfo.version },
        capabilities: { experimentalApi: false, requestAttestation: false } }, value => {
        const result = record(value, 'initialization'); nonempty(result.userAgent, 'user agent');
        // Send in the ordered response callback, not a continuation after later wire events.
        this.connection.notify('initialized', {}); this.state = 'ready';
      });
    } catch (error) { this.disconnect(error); throw error; }
  }

  /** Creates only a durable, exact-project thread; never starts provider work. */
  async open(cwd: string, savedThreadId?: string): Promise<CodexThread> {
    if (this.state !== 'ready') throw new Error('Codex thread opening is unavailable');
    nonempty(cwd, 'project cwd');
    if (savedThreadId !== undefined) nonempty(savedThreadId, 'saved thread ID');
    this.state = 'opening';
    let opened!: CodexThread;
    try {
      await this.rpc(savedThreadId === undefined ? 'thread/start' : 'thread/resume',
        savedThreadId === undefined ? { cwd, ephemeral: false } : { threadId: savedThreadId, cwd, excludeTurns: true }, value => {
          const result = record(value, 'thread response'); const candidate = thread(result.thread);
          if (candidate.cwd !== cwd || result.cwd !== cwd || candidate.ephemeral || savedThreadId !== undefined && candidate.id !== savedThreadId)
            throw new Error('Codex returned a conflicting thread identity or project');
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
    await this.rpc('thread/list', { cwd, ...(cursor === undefined ? {} : { cursor }), limit: 100, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], archived: false }, value => {
      const decoded = page(value, thread);
      // Server filtering is not an authorization boundary. Never return another project.
      result = { ...decoded, data: decoded.data.filter(entry => entry.cwd === cwd && !entry.ephemeral && entry.parentThreadId == null) };
    });
    return result;
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
  /** Supported resume overrides, with strict result confirmation; never submits a turn. */
  async configure(cwd: string, setting: 'model' | 'effort', value: string): Promise<RpcRecord> {
    if (this.state !== 'idle') throw new Error('Codex configuration requires idle');
    const threadId = this.requireBound(); nonempty(value, 'configuration value');
    let result!: RpcRecord;
    await this.rpc('thread/resume', { threadId, cwd, excludeTurns: true,
      ...(setting === 'model' ? { model: value } : { config: { model_reasoning_effort: value } }) }, data => {
      result = record(data, 'configuration');
      const identity = thread(result.thread);
      if (identity.id !== threadId || identity.cwd !== cwd || result.cwd !== cwd) throw new Error('Codex configuration returned a conflicting identity');
      if (identity.status.type !== 'idle' || this.state !== 'idle') throw new Error('Codex configuration overlapped active work; effective state is uncertain');
      if ((setting === 'model' ? result.model : result.reasoningEffort) !== value)
        throw new Error('Codex did not confirm the requested setting on this loaded thread');
    });
    return result;
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
      if (this.early.length >= MAX_EARLY_EVENTS || this.earlyBytes + bytes > MAX_EARLY_BYTES) throw new Error('Codex pre-identity event buffer exceeded');
      this.early.push({ method, params }); this.earlyBytes += bytes; return;
    }
    // App-server may report child-agent threads. They are not this conversation.
    const threadId = params.threadId ?? (isRecord(params.thread) ? params.thread.id : undefined);
    if (!this.bound || threadId !== this.bound.id) return;
    if (['thread/closed', 'thread/deleted', 'thread/archived'].includes(method)) { this.disconnect(`Codex reported ${method}. Saved identity and draft were retained.`); return; }
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
  private request(method: string, value: unknown, signal: AbortSignal, id: RpcId): Promise<unknown> {
    if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval') throw new RpcResponseError(-32601, 'Codex request is not supported by Nimrod');
    const params = record(value, 'approval');
    // Live resume may omit turns, but the server's thread-scoped request itself
    // supplies authoritative active-turn identity before history hydration.
    if (this.bound && params.threadId === this.bound.id && this.state === 'working' && !this.currentTurn && !this.startingTurn)
      this.currentTurn = { id: nonempty(params.turnId, 'approval turn ID'), completed: false };
    if (!this.bound || params.threadId !== this.bound.id || this.state !== 'working' || params.turnId !== this.activeTurnId)
      throw new RpcResponseError(-32602, 'Approval does not belong to the active Nimrod thread and turn');
    nonempty(params.itemId, 'approval item ID');
    if (!this.hooks.approval) throw new RpcResponseError(-32601, 'Codex approvals are unavailable');
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      if (this.decisions.get(id)?.controller === controller) this.decisions.delete(id);
    };
    signal.addEventListener('abort', abort, { once: true });
    this.decisions.set(id, { turnId: params.turnId as string, controller });
    let pending: Promise<CodexApprovalDecision>;
    try { pending = this.hooks.approval({ kind: method === 'item/commandExecution/requestApproval' ? 'command' : 'fileChange',
      threadId: this.bound.id, turnId: params.turnId as string, itemId: params.itemId as string, native: params }, controller.signal); }
    catch (error) { pending = Promise.reject(error); }
    return pending.then(decision => {
      if (controller.signal.aborted) throw new RpcResponseError(-32800, 'Codex approval is no longer pending');
      if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) throw new RpcResponseError(-32602, 'Unsupported Codex approval decision');
      return { decision };
    }).finally(() => {
      signal.removeEventListener('abort', abort);
      if (this.decisions.get(id)?.controller === controller) this.decisions.delete(id);
    });
  }
  private abortTurnDecisions(turnId: string): void {
    for (const [id, decision] of this.decisions) if (decision.turnId === turnId) this.connection.cancelIncoming(id);
  }
}
