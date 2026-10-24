/** Ordered JSON-RPC mechanics only. Harness handshakes, semantics and native ownership stay concrete. */
export type RpcRecord = Record<string, unknown>;
export type RpcId = string | number;
export type RpcPacket = RpcRecord & { jsonrpc?: '2.0' };
export const isRecord = (value: unknown): value is RpcRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isRpcId = (value: unknown): value is RpcId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));

export class RpcResponseError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); }
}

/** Delivery may have happened. Callers must not replay requests after this error. */
export class RpcConnectionError extends Error {}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  apply?(value: unknown): void;
}

export interface RpcConnectionHandlers {
  notification?(method: string, params: unknown): void;
  /** Invoked synchronously in wire order; return a promise only for the reply wait. */
  request?(method: string, params: unknown, signal: AbortSignal, id: RpcId): unknown | Promise<unknown>;
  disconnected?(error: RpcConnectionError): void;
}

/**
 * The host supplies already-decoded records in wire order and an ordered writer.
 * Framing, byte bounds, process ownership and observed shutdown belong to that host.
 * Instances are single-use: reconnect with a new instance, never reset/replay one.
 */
export class JsonRpcConnection {
  private sequence = 0;
  private pending = new Map<RpcId, Pending>();
  private incoming = new Map<RpcId, AbortController>();
  private failure?: RpcConnectionError;

  constructor(
    private send: (packet: RpcPacket) => void | Promise<void>,
    private handlers: RpcConnectionHandlers = {},
    private dialect: { label: string; versionMember: boolean } = { label: 'JSON-RPC', versionMember: true },
  ) {}

  get connected(): boolean { return !this.failure; }

  request(method: string, params: RpcRecord, apply?: (value: unknown) => void): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, apply });
      this.write({ ...this.header(), id, method, params });
    });
  }

  notify(method: string, params: RpcRecord): void {
    if (this.failure) throw this.failure;
    this.write({ ...this.header(), method, params });
    if (this.failure) throw this.failure;
  }

  receive(value: unknown): void {
    if (this.failure) return;
    try {
      if (!isRecord(value) || (this.dialect.versionMember ? value.jsonrpc !== '2.0' : 'jsonrpc' in value)) throw new Error(`Invalid ${this.dialect.label} JSON-RPC record`);
      if ('method' in value) {
        if (typeof value.method !== 'string' || !value.method || 'result' in value || 'error' in value)
          throw new Error(`Invalid ${this.dialect.label} method record`);
        if ('params' in value && !isRecord(value.params)) throw new Error(`Invalid ${this.dialect.label} method parameters`);
        if ('id' in value) {
          if (!isRpcId(value.id)) throw new Error(`Invalid ${this.dialect.label} request ID`);
          this.agentRequest(value.id, value.method, value.params);
        } else this.handlers.notification?.(value.method, value.params);
        return;
      }
      if (!isRpcId(value.id) || ('result' in value) === ('error' in value))
        throw new Error(`Invalid ${this.dialect.label} response`);
      let error: RpcResponseError | undefined;
      if ('error' in value) {
        if (!isRecord(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string')
          throw new Error(`Invalid ${this.dialect.label} response error`);
        error = new RpcResponseError(value.error.code as number, value.error.message, value.error.data);
      }
      const pending = this.pending.get(value.id);
      if (!pending) return;
      if (error) {
        this.pending.delete(value.id);
        pending.reject(error);
      } else {
        // Apply authoritative results synchronously before the next wire event.
        // Keep the request registered until validation succeeds, so failure rejects it too.
        pending.apply?.(value.result);
        this.pending.delete(value.id);
        pending.resolve(value.result);
      }
    } catch (error) { this.disconnect(error); }
  }

  disconnect(reason: unknown = `${this.dialect.label} connection closed`): void {
    if (this.failure) return;
    const error = reason instanceof RpcConnectionError ? reason
      : new RpcConnectionError(reason instanceof Error ? reason.message : String(reason));
    this.failure = error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const controller of this.incoming.values()) controller.abort();
    this.incoming.clear();
    for (const request of pending) request.reject(error);
    this.handlers.disconnected?.(error);
  }

  /** Server-resolved requests retire their UI callbacks without sending a synthetic answer. */
  cancelIncoming(id: RpcId): void {
    this.incoming.get(id)?.abort();
    this.incoming.delete(id);
  }

  private header(): RpcRecord { return this.dialect.versionMember ? { jsonrpc: '2.0' } : {}; }

  private write(packet: RpcPacket): void {
    if (this.failure) return;
    try {
      const sent = this.send(packet);
      if (sent) void sent.catch(error => this.disconnect(error));
    } catch (error) { this.disconnect(error); }
  }

  private agentRequest(id: RpcId, method: string, params: unknown): void {
    if (this.incoming.has(id)) throw new Error(`Duplicate active ${this.dialect.label} request ID`);
    const controller = new AbortController();
    this.incoming.set(id, controller);
    // Reserve the ID before invoking the handler, including reentrant delivery.
    // Retained-state processing must precede the next wire record; only awaiting
    // the reply (e.g. a user's permission choice) belongs on the promise path.
    let response: unknown;
    try {
      if (!this.handlers.request) throw new RpcResponseError(-32601, 'Method not found');
      response = this.handlers.request(method, params, controller.signal, id);
    } catch (error) {
      // Request-local failures still become RPC errors, not disconnections.
      response = Promise.reject(error);
    }
    void Promise.resolve(response).then(result => {
      if (controller.signal.aborted || this.failure) return;
      this.incoming.delete(id);
      this.write({ ...this.header(), id, result: result ?? null });
    }, error => {
      if (controller.signal.aborted || this.failure) return;
      this.incoming.delete(id);
      this.write({ ...this.header(), id, error: {
        code: error instanceof RpcResponseError ? error.code : -32603,
        message: error instanceof RpcResponseError ? error.message : 'Client request failed',
      } });
    });
  }
}
