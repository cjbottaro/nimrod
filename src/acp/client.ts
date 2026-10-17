import packageInfo from '../../package.json';
import { AcpConnection, AcpResponseError, isRecord, type AcpPacket, type AcpRecord } from './connection';

export type AcpClientPhase = 'fresh' | 'initializing' | 'ready' | 'creating' | 'loading' | 'idle' | 'working' | 'disconnected';
export interface AcpSessionUpdate { sessionId: string; update: AcpRecord & { sessionUpdate: string }; }
export interface AcpPermissionOption { optionId: string; name: string; kind: string; }
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpRecord;
  options: readonly AcpPermissionOption[];
}
export interface AcpClientHooks {
  created?(configuration: AcpRecord): void;
  loaded?(configuration: AcpRecord): void;
  configured?(configuration: AcpRecord): void;
  selected?(kind: 'model' | 'mode', id: string): void;
  /** Synchronous ordered delivery, not a coalesced paint callback. */
  update?(event: AcpSessionUpdate): void;
  /** Called synchronously in receive order so tool patches precede later records.
   * Return a promise for an offered optionId or undefined to cancel; never default to approval. */
  permission?(request: AcpPermissionRequest, signal: AbortSignal): Promise<string | undefined>;
  disconnected?(error: Error): void;
}

const cancelled = () => ({ outcome: { outcome: 'cancelled' } });
const permissionKinds = new Set(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
const stopReasons = new Set(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']);

/**
 * ACP v1 subset: one new or loaded session per connection, text prompts, updates,
 * cancellation and permission responses. No native launch or transcript adapter.
 * No generic Pi session interface, history emulation, implicit queue or retries.
 */
export class AcpClient {
  private connection: AcpConnection;
  private currentPhase: AcpClientPhase = 'fresh';
  private currentSession?: string;
  private initialized?: AcpRecord;
  private created?: AcpRecord;
  private earlyUpdates: AcpSessionUpdate[] = [];
  private earlyBytes = 0;
  private turn?: AbortController;

  constructor(send: (packet: AcpPacket) => void | Promise<void>, private hooks: AcpClientHooks = {}) {
    this.connection = new AcpConnection(send, {
      notification: (method, params) => this.notification(method, params),
      request: (method, params, signal) => this.agentRequest(method, params, signal),
      disconnected: error => {
        this.currentPhase = 'disconnected';
        this.turn?.abort();
        this.earlyUpdates = []; this.earlyBytes = 0;
        hooks.disconnected?.(error);
      },
    });
  }

  get phase(): AcpClientPhase { return this.currentPhase; }
  get sessionId(): string | undefined { return this.currentSession; }
  /** Preserves agent-specific capabilities/configuration without claiming support. */
  get initialization(): AcpRecord | undefined { return this.initialized; }
  get sessionConfiguration(): AcpRecord | undefined { return this.created; }

  receive(packet: unknown): void { this.connection.receive(packet); }
  disconnect(reason?: unknown): void { this.connection.disconnect(reason); }

  async initialize(): Promise<void> {
    this.requirePhase('fresh');
    this.currentPhase = 'initializing';
    try {
      await this.connection.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'nimrod', title: 'Nimrod', version: packageInfo.version },
      }, value => {
        if (!isRecord(value) || value.protocolVersion !== 1 || !isRecord(value.agentCapabilities))
          throw new Error('Unsupported or invalid ACP initialization response');
        this.initialized = value;
        this.currentPhase = 'ready';
      });
    } catch (error) {
      this.disconnect(error);
      throw error;
    }
  }

  /** The native host validates the canonical, absolute project cwd. */
  async newSession(cwd: string): Promise<string> {
    this.requirePhase('ready');
    if (!cwd.trim()) throw new Error('ACP session requires a project directory');
    this.currentPhase = 'creating';
    try {
      await this.connection.request('session/new', { cwd, mcpServers: [] }, value => {
        if (!isRecord(value) || typeof value.sessionId !== 'string' || !value.sessionId.trim())
          throw new Error('Invalid ACP session identity');
        const id = value.sessionId;
        if (this.earlyUpdates.some(event => event.sessionId !== id)) throw new Error('ACP session identity mismatch');
        this.currentSession = id;
        this.created = value;
        this.currentPhase = 'idle';
        const updates = this.earlyUpdates;
        this.earlyUpdates = []; this.earlyBytes = 0;
        for (const update of updates) this.hooks.update?.(update);
        this.hooks.created?.(value);
      });
      return this.currentSession!;
    } catch (error) {
      // No implicit replacement session after failed/uncertain creation.
      this.disconnect(error);
      throw error;
    }
  }

  async loadSession(cwd: string, sessionId: string): Promise<void> {
    this.requirePhase('ready');
    if (!cwd.trim() || !sessionId.trim()) throw new Error('ACP loading requires a project directory and session ID');
    const capabilities = this.initialized?.agentCapabilities;
    if (!isRecord(capabilities) || capabilities.loadSession !== true)
      throw new Error('This ACP agent does not support loading saved sessions. Nothing was created or sent.');
    // Identity is already known. Replay can exceed the small pre-new buffer and
    // must be reduced synchronously as it arrives, before the load response.
    this.currentSession = sessionId;
    this.currentPhase = 'loading';
    try {
      await this.connection.request('session/load', { cwd, sessionId, mcpServers: [] }, value => {
        if (!isRecord(value) || (value.sessionId !== undefined && value.sessionId !== sessionId))
          throw new Error('Invalid ACP loaded session identity');
        this.created = value;
        this.currentPhase = 'idle';
        this.hooks.loaded?.(value);
      });
    } catch (error) {
      this.disconnect(error);
      throw error;
    }
  }

  async prompt(text: string): Promise<string> {
    this.requirePhase('idle');
    if (!text.trim()) throw new Error('ACP prompt is empty');
    this.currentPhase = 'working';
    const turn = new AbortController();
    this.turn = turn;
    let stopReason = '';
    try {
      // ACP replies when the turn ENDS. No Pi-style acceptance timeout.
      await this.connection.request('session/prompt', {
        sessionId: this.currentSession,
        prompt: [{ type: 'text', text }],
      }, value => {
        if (!isRecord(value) || typeof value.stopReason !== 'string' || !stopReasons.has(value.stopReason))
          throw new Error('Invalid ACP prompt completion');
        stopReason = value.stopReason;
        this.finishTurn(turn);
      });
      return stopReason;
    } catch (error) {
      // Explicit RPC rejection and connection uncertainty stay distinguishable.
      // Both retire this local turn; neither retries or restores a draft.
      this.finishTurn(turn);
      throw error;
    }
  }

  async setConfigOption(configId: string, value: string): Promise<unknown> {
    this.requirePhase('idle');
    return this.connection.request('session/set_config_option', { sessionId: this.currentSession, configId, value }, result => {
      if (!isRecord(result) || !Array.isArray(result.configOptions)) throw new Error('Invalid ACP configuration response');
      this.created = { ...this.created, configOptions: result.configOptions };
      this.hooks.configured?.(this.created);
    });
  }

  async setMode(modeId: string): Promise<unknown> {
    this.requirePhase('idle');
    return this.connection.request('session/set_mode', { sessionId: this.currentSession, modeId }, result => {
      if (!isRecord(result)) throw new Error('Invalid ACP mode response');
      this.hooks.selected?.('mode', modeId);
    });
  }

  async setModel(modelId: string): Promise<unknown> {
    this.requirePhase('idle');
    return this.connection.request('session/set_model', { sessionId: this.currentSession, modelId }, result => {
      if (!isRecord(result)) throw new Error('Invalid ACP model response');
      this.hooks.selected?.('model', modelId);
    });
  }

  cancel(): void {
    if (this.currentPhase !== 'working' || !this.turn || this.turn.signal.aborted) return;
    // Cancels pending permission choices immediately, but stays working until
    // the authoritative prompt response (or a connection failure) arrives.
    this.turn.abort();
    this.connection.notify('session/cancel', { sessionId: this.currentSession });
  }

  private requirePhase(phase: AcpClientPhase): void {
    if (this.currentPhase !== phase) throw new Error(`ACP operation unavailable while ${this.currentPhase}`);
  }

  private finishTurn(turn: AbortController): void {
    if (this.turn !== turn) return;
    turn.abort();
    this.turn = undefined;
    if (this.currentPhase !== 'disconnected') this.currentPhase = 'idle';
  }

  private notification(method: string, params: unknown): void {
    if (method !== 'session/update') return; // Unknown extension notifications are optional.
    if (!isRecord(params) || typeof params.sessionId !== 'string' || !isRecord(params.update)
      || typeof params.update.sessionUpdate !== 'string') throw new Error('Invalid ACP session update');
    const event: AcpSessionUpdate = {
      sessionId: params.sessionId,
      update: params.update as AcpSessionUpdate['update'],
    };
    if (this.currentPhase === 'creating') {
      // Some agents advertise commands before returning session/new. Bound the
      // buffer; overflow fails the connection rather than silently losing data.
      this.earlyBytes += new TextEncoder().encode(JSON.stringify(event)).length;
      if (this.earlyUpdates.length >= 128 || this.earlyBytes > 16 * 1024 * 1024) throw new Error('Too many ACP updates before session identity');
      this.earlyUpdates.push(event);
    } else {
      if (!this.currentSession || event.sessionId !== this.currentSession) throw new Error('ACP session identity mismatch');
      this.hooks.update?.(event);
    }
  }

  private agentRequest(method: string, params: unknown, signal: AbortSignal): Promise<unknown> | unknown {
    if (method !== 'session/request_permission') throw new AcpResponseError(-32601, 'Method not found');
    if (!isRecord(params) || typeof params.sessionId !== 'string' || !isRecord(params.toolCall)
      || typeof params.toolCall.toolCallId !== 'string' || !Array.isArray(params.options) || !params.options.length)
      throw new AcpResponseError(-32602, 'Invalid permission request');
    const options: AcpPermissionOption[] = [];
    for (const option of params.options) {
      if (!isRecord(option) || typeof option.optionId !== 'string' || !option.optionId
        || typeof option.name !== 'string' || typeof option.kind !== 'string' || !permissionKinds.has(option.kind)
        || options.some(previous => previous.optionId === option.optionId))
        throw new AcpResponseError(-32602, 'Invalid permission options');
      options.push({ optionId: option.optionId, name: option.name, kind: option.kind });
    }
    const turn = this.turn;
    if (params.sessionId !== this.currentSession || !turn || turn.signal.aborted || !this.hooks.permission)
      return cancelled();
    const request: AcpPermissionRequest = { sessionId: params.sessionId, toolCall: params.toolCall, options };
    return new Promise(resolve => {
      const controller = new AbortController();
      let settled = false;
      const finish = (optionId?: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        turn.signal.removeEventListener('abort', abort);
        controller.abort();
        resolve(optionId !== undefined && options.some(option => option.optionId === optionId)
          ? { outcome: { outcome: 'selected', optionId } } : cancelled());
      };
      const abort = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      turn.signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted || turn.signal.aborted) { finish(); return; }
      try { void this.hooks.permission!(request, controller.signal).then(finish, () => finish()); }
      catch { finish(); }
    });
  }
}
