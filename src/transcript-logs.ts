/** Shared opt-in transcript logging; native payloads retain their harness-specific shapes. */
export interface TranscriptLogRecord {
  source: { backend: string; agent: string; version?: string };
  sessionId: string;
  /** Stable for one integration connection, including early native-identity discovery. */
  connectionId?: string;
  toolCallId?: string;
  event: string;
  payload: unknown;
}
export interface TranscriptLogSink {
  readonly enabled: boolean;
  /** Synchronous snapshot/enqueue only; never waits for storage or throws into an integration. */
  append(record: TranscriptLogRecord): void;
}
export interface TranscriptLogHost {
  write(lines: string[]): Promise<unknown>;
  failure(message: string): void;
  recovered(): void;
}
const MAX_QUEUE_CHARS = 8 * 1024 * 1024;
const CHUNK_RECORD_CHARS = 2 * 1024 * 1024;
const FLUSH_CHARS = 1024 * 1024;
const CHUNK_CHARS = 128 * 1024;

/** One writer per project window. A failed/overflowed capture stays stopped until toggled. */
export function createTranscriptLog(host: TranscriptLogHost) {
  let enabled = false, failed = false, disposed = false, writing = false;
  let captureId = '', sequence = 0, generation = 0;
  let pending: string[] = [], queuedChars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; pending = []; queuedChars = 0; };
  function fail(error: unknown): void {
    if (failed || disposed) return;
    failed = true; clear();
    try { host.failure(`Conversation unaffected; diagnostic logging stopped. Some events may not have been saved. ${String(error)} Toggle transcript debug logs off and on to start a new segment. Nothing was retried.`); }
    catch (noticeError) { console.error('Could not report transcript debug logging failure', noticeError); }
  }
  async function flush(): Promise<void> {
    clearTimeout(timer); timer = undefined;
    if (writing || !pending.length || !enabled || failed || disposed) return;
    // History replay can synchronously deliver more than one native batch.
    // Bound pending bytes, not event count; dispatch at most 512 records per write.
    const lines = pending.splice(0, 512);
    queuedChars -= lines.reduce((total, line) => total + line.length, 0);
    const current = generation;
    writing = true;
    try { await host.write(lines); }
    catch (error) { if (!disposed && current === generation) fail(error); }
    finally {
      writing = false;
      if (pending.length && enabled && !failed && !disposed) void flush();
    }
  }
  function schedule(): void {
    if (!timer && !writing && pending.length && enabled && !failed && !disposed) timer = setTimeout(() => { void flush(); }, 100);
  }
  function enqueue(line: string): boolean {
    if (!enabled || failed || disposed) return false;
    if (queuedChars + line.length > MAX_QUEUE_CHARS) {
      fail('Transcript events exceeded the 8 Mi-character pending buffer while storage was busy.'); return false;
    }
    pending.push(line); queuedChars += line.length;
    if (pending.length >= 512 || queuedChars >= FLUSH_CHARS) void flush();
    else schedule();
    return enabled && !failed && !disposed;
  }
  return {
    get enabled() { return enabled && !failed && !disposed; },
    setEnabled(value: boolean): void {
      if (disposed || value === enabled) return;
      enabled = value; generation++; clear(); failed = false;
      if (value) { captureId = crypto.randomUUID(); sequence = 0; host.recovered(); }
    },
    append(record: TranscriptLogRecord): void {
      if (!enabled || failed || disposed) return;
      try {
        // Snapshot now: native reducers may subsequently change retained objects.
        const line = JSON.stringify({ ...record, schemaVersion: 1, timestamp: new Date().toISOString(), captureId, sequence: ++sequence });
        if (line.length <= CHUNK_RECORD_CHARS) { enqueue(line); return; }
        // Split the serialized snapshot, not the native payload; joining all parts restores it exactly.
        const snapshot: Record<string, unknown> = JSON.parse(line);
        delete snapshot.payload;
        const recordId = `${captureId}:${sequence}`, count = Math.ceil(line.length / CHUNK_CHARS);
        for (let index = 0; index < count; index++) {
          const chunk = JSON.stringify({ ...snapshot, sequence: index === 0 ? sequence : ++sequence,
            event: 'capture.record_chunk', payload: { recordId, index, count, data: line.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) } });
          if (!enqueue(chunk)) return;
        }
      } catch (error) { fail(error); }
    },
    flush,
    /** Best effort: dispatch an available tail; app/process exit is not a durability barrier. */
    dispose(): void { if (!writing) void flush(); disposed = true; generation++; clear(); },
  };
}
