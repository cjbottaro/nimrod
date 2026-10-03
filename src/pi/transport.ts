import type { JsonRecord } from './types';

export type Packet = { kind: 'rpc'; value: JsonRecord } | { kind: 'disconnected'; message: string };
export class RpcResponseError extends Error {}
export class RpcTransportError extends Error {}
interface Pending {
  resolve(value: JsonRecord): void;
  reject(error: Error): void;
  onResponse?: (value: JsonRecord) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Pi-specific correlation; Rust owns byte framing, IO, process lifetime and ordered delivery. */
export class PiTransport {
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private failure?: Error;
  onEvent: (event: JsonRecord) => void = () => {};
  constructor(private readonly write: (message: JsonRecord) => Promise<void>) {}

  receive(packet: Packet): void {
    if (this.failure) return;
    if (packet.kind === 'disconnected') { this.disconnect(packet.message); return; }
    const event = packet.value;
    if (event.type !== 'response') { this.onEvent(event); return; }
    const pending = typeof event.id === 'string' ? this.pending.get(event.id) : undefined;
    if (!pending) return;
    this.pending.delete(event.id as string);
    clearTimeout(pending.timer);
    if (event.success !== true) {
      pending.reject(new RpcResponseError(typeof event.error === 'string' ? event.error : 'Pi rejected the request'));
      return;
    }
    try {
      // Must apply history/state before the next channel packet, not in a Promise continuation.
      pending.onResponse?.(event);
      pending.resolve(event);
    } catch (error) { pending.reject(error instanceof Error ? error : new Error(String(error))); }
  }

  request(type: string, fields: JsonRecord = {}, timeoutMs = 20_000, onResponse?: (value: JsonRecord) => void): Promise<JsonRecord> {
    if (this.failure) return Promise.reject(this.failure);
    const id = `nimrod-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTransportError(`Pi did not acknowledge ${type}; acceptance may be unknown. Nothing was retried.`));
      }, timeoutMs) : undefined;
      this.pending.set(id, { resolve, reject, timer, onResponse });
      void this.write({ ...fields, id, type }).catch(error => this.disconnect(String(error)));
    });
  }

  async respond(fields: JsonRecord): Promise<void> {
    if (this.failure) throw this.failure;
    try { await this.write({ ...fields, type: 'extension_ui_response' }); }
    catch (error) { this.disconnect(String(error)); throw error; }
  }

  disconnect(message: string): void {
    if (this.failure) return;
    this.failure = new RpcTransportError(message);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
    this.onEvent({ type: 'process_error', error: message });
  }
}
