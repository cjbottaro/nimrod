/** Consumer-oriented capture port: integrations retain their native event semantics. */
export interface ToolCaptureRecord {
  source: { backend: string; agent: string; version?: string };
  sessionId: string;
  /** Stable for one integration connection, including early native-identity discovery. */
  connectionId?: string;
  toolCallId?: string;
  event: string;
  payload: unknown;
}
export interface ToolCaptureSink {
  readonly enabled: boolean;
  /** Synchronous snapshot/enqueue only; never waits for storage or throws into an integration. */
  append(record: ToolCaptureRecord): void;
}
export interface ToolCaptureHost {
  write(lines: string[]): Promise<unknown>;
  failure(message: string): void;
  recovered(): void;
}
const MAX_QUEUE_CHARS = 8 * 1024 * 1024;
const MAX_RECORD_CHARS = 2 * 1024 * 1024;

/** One writer per project window. A failed/overflowed capture stays stopped until toggled. */
export function createToolCapture(host: ToolCaptureHost) {
  let enabled = false, failed = false, disposed = false, writing = false;
  let captureId = '', sequence = 0, generation = 0;
  let pending: string[] = [], queuedChars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; pending = []; queuedChars = 0; };
  function fail(error: unknown): void {
    if (failed || disposed) return;
    failed = true; clear();
    try { host.failure(`Tool capture stopped; some events may not have been saved. ${String(error)} Toggle capture off and on to start a new segment. Nothing was retried.`); }
    catch (noticeError) { console.error('Could not report tool capture failure', noticeError); }
  }
  async function flush(): Promise<void> {
    clearTimeout(timer); timer = undefined;
    if (writing || !pending.length || !enabled || failed || disposed) return;
    const lines = pending; pending = []; queuedChars = 0;
    const current = generation;
    writing = true;
    try { await host.write(lines); }
    catch (error) { if (!disposed && current === generation) fail(error); }
    finally { writing = false; schedule(); }
  }
  function schedule(): void {
    if (!timer && !writing && pending.length && enabled && !failed && !disposed) timer = setTimeout(() => { void flush(); }, 100);
  }
  return {
    get enabled() { return enabled && !failed && !disposed; },
    setEnabled(value: boolean): void {
      if (disposed || value === enabled) return;
      enabled = value; generation++; clear(); failed = false;
      if (value) { captureId = crypto.randomUUID(); sequence = 0; host.recovered(); }
    },
    append(record: ToolCaptureRecord): void {
      if (!enabled || failed || disposed) return;
      try {
        // Snapshot now: native reducers may subsequently change retained objects.
        const line = JSON.stringify({ ...record, schemaVersion: 1, timestamp: new Date().toISOString(), captureId, sequence: ++sequence });
        if (line.length > MAX_RECORD_CHARS || queuedChars + line.length > MAX_QUEUE_CHARS || pending.length >= 512) {
          fail('Capture buffer or record size limit exceeded.'); return;
        }
        pending.push(line); queuedChars += line.length; schedule();
      } catch (error) { fail(error); }
    },
    flush,
    /** Best effort: dispatch an available tail; app/process exit is not a durability barrier. */
    dispose(): void { if (!writing) void flush(); disposed = true; generation++; clear(); },
  };
}
