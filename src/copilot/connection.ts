export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export class CopilotConnectionError extends Error {}
export interface BridgeRequest { id: string; method: string; [key: string]: unknown; }

/** Correlation for Nimrod's bridge, not a client for the SDK's wire protocol. */
export class CopilotConnection {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  constructor(private send: (message: BridgeRequest) => Promise<void>, private event: (message: Record<string, unknown>) => void, private ended: (reason: string) => void) {}
  request(method: string, params: Record<string, unknown> = {}, timeoutPolicy: 'disconnect' | 'reject' = 'disconnect'): Promise<unknown> {
    if (this.closed) return Promise.reject(new CopilotConnectionError('Copilot SDK bridge is disconnected'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Optional read-only metadata may fail independently of a healthy chat.
        // Mutations retain their existing uncertain-delivery disconnect policy.
        if (timeoutPolicy === 'reject') { this.pending.delete(id); reject(new Error('Optional Copilot metadata request timed out.')); }
        else this.disconnect('Copilot request timed out; its outcome is unknown. Nothing was retried.');
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ ...params, id, method }).catch(error => this.disconnect(`Copilot write failed; delivery is unknown: ${String(error)}`));
    });
  }
  receive(value: unknown): void {
    if (this.closed) return;
    try {
      if (!record(value)) throw new Error('Invalid Copilot bridge record');
      if (value.kind === 'result') {
        if (typeof value.id !== 'string') throw new Error('Invalid Copilot response identity');
        const failed = Object.hasOwn(value, 'error');
        if (failed === Object.hasOwn(value, 'result') || failed && (typeof value.error !== 'string' || !value.error))
          throw new Error('Invalid Copilot result envelope');
        const pending = this.pending.get(value.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(value.id);
        if (typeof value.error === 'string') pending.reject(new Error(value.error));
        else pending.resolve(value.result);
      } else if (value.kind === 'fatal') throw new Error(String(value.error));
      else this.event(value);
    } catch (error) { this.disconnect(`Copilot SDK event processing failed: ${String(error)}`); }
  }
  disconnect(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new CopilotConnectionError(reason)); }
    this.pending.clear(); this.ended(reason);
  }
}
