/** ACP's JSON-RPC boundary. No Pi protocol, native IPC or UI dependencies. */
export type AcpRecord = Record<string, unknown>;
export type AcpId = string | number;
export type AcpPacket = AcpRecord & { jsonrpc: '2.0' };
export const isRecord = (value: unknown): value is AcpRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is AcpId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));

export class AcpResponseError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); }
}

/** Delivery may have happened. Callers must not replay requests after this error. */
export class AcpConnectionError extends Error {}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  apply?(value: unknown): void;
}

export interface AcpConnectionHandlers {
  notification?(method: string, params: unknown): void;
  /** Invoked synchronously in wire order; return a promise only for the reply wait. */
  request?(method: string, params: unknown, signal: AbortSignal): unknown | Promise<unknown>;
  disconnected?(error: AcpConnectionError): void;
}

/**
 * The host supplies already-decoded records in wire order and an ordered writer.
 * Framing, byte bounds, process ownership and observed shutdown belong to that host.
 * Instances are single-use: reconnect with a new instance, never reset/replay one.
 */
export class AcpConnection {
  private sequence = 0;
  private pending = new Map<AcpId, Pending>();
  private incoming = new Map<AcpId, AbortController>();
  private failure?: AcpConnectionError;

  constructor(
    private send: (packet: AcpPacket) => void | Promise<void>,
    private handlers: AcpConnectionHandlers = {},
  ) {}

  get connected(): boolean { return !this.failure; }

  request(method: string, params: AcpRecord, apply?: (value: unknown) => void): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, apply });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: AcpRecord): void {
    if (this.failure) throw this.failure;
    this.write({ jsonrpc: '2.0', method, params });
    if (this.failure) throw this.failure;
  }

  receive(value: unknown): void {
    if (this.failure) return;
    try {
      if (!isRecord(value) || value.jsonrpc !== '2.0') throw new Error('Invalid ACP JSON-RPC record');
      if ('method' in value) {
        if (typeof value.method !== 'string' || !value.method || 'result' in value || 'error' in value)
          throw new Error('Invalid ACP method record');
        if ('params' in value && !isRecord(value.params)) throw new Error('Invalid ACP method parameters');
        if ('id' in value) {
          if (!isId(value.id)) throw new Error('Invalid ACP request ID');
          this.agentRequest(value.id, value.method, value.params);
        } else this.handlers.notification?.(value.method, value.params);
        return;
      }
      if (!isId(value.id) || ('result' in value) === ('error' in value))
        throw new Error('Invalid ACP response');
      let error: AcpResponseError | undefined;
      if ('error' in value) {
        if (!isRecord(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string')
          throw new Error('Invalid ACP response error');
        error = new AcpResponseError(value.error.code as number, value.error.message, value.error.data);
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

  disconnect(reason: unknown = 'ACP connection closed'): void {
    if (this.failure) return;
    const error = reason instanceof AcpConnectionError ? reason
      : new AcpConnectionError(reason instanceof Error ? reason.message : String(reason));
    this.failure = error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const controller of this.incoming.values()) controller.abort();
    this.incoming.clear();
    for (const request of pending) request.reject(error);
    this.handlers.disconnected?.(error);
  }

  private write(packet: AcpPacket): void {
    if (this.failure) return;
    try {
      const sent = this.send(packet);
      if (sent) void sent.catch(error => this.disconnect(error));
    } catch (error) { this.disconnect(error); }
  }

  private agentRequest(id: AcpId, method: string, params: unknown): void {
    if (this.incoming.has(id)) throw new Error('Duplicate active ACP request ID');
    const controller = new AbortController();
    this.incoming.set(id, controller);
    // Reserve the ID before invoking the handler, including reentrant delivery.
    // Retained-state processing must precede the next wire record; only awaiting
    // the reply (e.g. a user's permission choice) belongs on the promise path.
    let response: unknown;
    try {
      if (!this.handlers.request) throw new AcpResponseError(-32601, 'Method not found');
      response = this.handlers.request(method, params, controller.signal);
    } catch (error) {
      // Request-local failures still become RPC errors, not disconnections.
      response = Promise.reject(error);
    }
    void Promise.resolve(response).then(result => {
      if (controller.signal.aborted || this.failure) return;
      this.incoming.delete(id);
      this.write({ jsonrpc: '2.0', id, result: result ?? null });
    }, error => {
      if (controller.signal.aborted || this.failure) return;
      this.incoming.delete(id);
      this.write({ jsonrpc: '2.0', id, error: {
        code: error instanceof AcpResponseError ? error.code : -32603,
        message: error instanceof AcpResponseError ? error.message : 'Client request failed',
      } });
    });
  }
}
