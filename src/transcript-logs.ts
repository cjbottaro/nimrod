/** Shared opt-in, best-effort logging. Diagnostic IO never gates session traffic. */
export interface TranscriptLogRecord {
  source: { backend: string; agent: string; version?: string };
  sessionId: string;
  connectionId?: string;
  toolCallId?: string;
  event: string;
  payload: unknown;
}
export interface TranscriptLogSink {
  readonly enabled: boolean;
  /** Snapshot before caller mutation, then enqueue without waiting for persistence. */
  append(record: TranscriptLogRecord): void;
}
export interface TranscriptLogHost {
  /** Resolves at native queue admission, not disk completion. False admission means dropped records. */
  write(lines: string[], captureId: string): Promise<unknown>;
  failure(message: string): void;
  recovered(): void;
  dropped?(count: number): void;
}
const MAX_PENDING_RECORDS = 4096;
const MAX_PENDING_CHARS = 16 * 1024 * 1024;
const BATCH_RECORDS = 512;
const BATCH_CHARS = 1024 * 1024;
const BATCH_DELAY_MS = 50;

/** Bounded snapshots, timed batching and one admission IPC in flight per window. */
export function createTranscriptLog(host: TranscriptLogHost) {
  let enabled = false, failed = false, disposed = false, generation = 0;
  let captureId = '', sequence = 0, chars = 0, dropped = 0, reportedDropped = 0;
  let pending: string[] = [];
  let writing: Promise<void> | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  function cancelSchedule(): void { clearTimeout(scheduled); scheduled = undefined; }
  function fail(error: unknown): void {
    if (failed || disposed) return;
    failed = true; pending = []; chars = 0; cancelSchedule();
    try { host.failure(`Conversation unaffected; diagnostic logging stopped. Some events may not have been saved. ${String(error)} Toggle transcript debug logs off and on to start a new segment. Nothing was retried.`); }
    catch (noticeError) { console.error('Could not report transcript debug logging failure', noticeError); }
  }
  function reportDropped(): void {
    if (disposed || failed || dropped === reportedDropped) return;
    reportedDropped = dropped;
    try { host.dropped?.(dropped); }
    catch (error) { console.error('Could not report dropped transcript records', error); }
  }
  function schedule(): void {
    if (scheduled !== undefined || disposed || failed) return;
    scheduled = setTimeout(() => { scheduled = undefined; reportDropped(); if (!writing) void flush(); }, BATCH_DELAY_MS);
  }
  async function drain(): Promise<void> {
    reportDropped();
    while (pending.length && enabled && !failed && !disposed) {
      let count = 0, batchChars = 0;
      while (count < pending.length && count < BATCH_RECORDS && (count === 0 || batchChars + pending[count].length <= BATCH_CHARS)) batchChars += pending[count++].length;
      const lines = pending.splice(0, count), current = generation, segment = captureId;
      chars -= batchChars;
      try {
        const result = await host.write(lines, segment);
        if (current === generation && result && typeof result === 'object' && 'accepted' in result && result.accepted === false) dropped += lines.length;
      } catch (error) { if (current === generation) fail(error); }
      if (current === generation) reportDropped();
    }
  }
  /** Explicit diagnostic/test boundary only; no harness producer awaits this. Not a disk/fsync receipt. */
  function flush(): Promise<void> {
    cancelSchedule();
    if (!writing) {
      writing = drain().finally(() => {
        writing = undefined;
        if (enabled && !failed && !disposed && (pending.length || dropped !== reportedDropped)) schedule();
      });
    }
    return writing;
  }
  return {
    get enabled() { return enabled && !failed && !disposed; },
    get droppedRecords() { return dropped; },
    setEnabled(value: boolean): void {
      if (disposed || value === enabled) return;
      enabled = value; generation++; pending = []; chars = 0; dropped = 0; reportedDropped = 0; failed = false; cancelSchedule();
      if (value) { captureId = crypto.randomUUID(); sequence = 0; host.recovered(); }
    },
    append(record: TranscriptLogRecord): void {
      if (!enabled || failed || disposed) return;
      const next = ++sequence; // Dropped events leave observable sequence gaps in the capture.
      if (pending.length >= MAX_PENDING_RECORDS || chars >= MAX_PENDING_CHARS) { dropped++; schedule(); return; }
      try {
        const line = JSON.stringify({ ...record, schemaVersion: 1, timestamp: new Date().toISOString(), captureId, sequence: next });
        if (line.length > MAX_PENDING_CHARS - chars) { dropped++; schedule(); return; }
        pending.push(line); chars += line.length; schedule();
      } catch (error) { fail(error); }
    },
    /** Native writer errors arrive asynchronously and must not retire a newer capture. */
    writeFailed(segment: string, error: string): void { if (enabled && segment === captureId) fail(error); },
    flush,
    dispose(): void { void flush(); disposed = true; generation++; pending = []; chars = 0; cancelSchedule(); },
  };
}
