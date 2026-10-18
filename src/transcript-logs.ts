/** Shared opt-in transcript logging; native payloads retain their harness-specific shapes. */
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
  /** Snapshot before caller mutation. The enclosing producer must await flush before more input. */
  append(record: TranscriptLogRecord): void;
  flush?(): Promise<void>;
}
export interface TranscriptLogHost {
  write(lines: string[]): Promise<unknown>;
  failure(message: string): void;
  recovered(): void;
}

/** One synchronous operation's snapshots; the native MPSC consumer owns write scheduling. */
export function createTranscriptLog(host: TranscriptLogHost) {
  let enabled = false, failed = false, disposed = false, generation = 0;
  let captureId = '', sequence = 0;
  let pending: string[] = [];
  let writing: Promise<void> | undefined;
  let scheduled = false;
  function fail(error: unknown): void {
    if (failed || disposed) return;
    failed = true; pending = [];
    try { host.failure(`Conversation unaffected; diagnostic logging stopped. Some events may not have been saved. ${String(error)} Toggle transcript debug logs off and on to start a new segment. Nothing was retried.`); }
    catch (noticeError) { console.error('Could not report transcript debug logging failure', noticeError); }
  }
  async function drain(): Promise<void> {
    while (pending.length && enabled && !failed && !disposed) {
      let count = 0, chars = 0;
      while (count < pending.length && count < 512 && (count === 0 || chars + pending[count].length <= 1024 * 1024)) chars += pending[count++].length;
      const lines = pending.splice(0, count), current = generation;
      try { await host.write(lines); }
      catch (error) { if (current === generation) fail(error); }
    }
  }
  function flush(): Promise<void> {
    if (!writing) {
      writing = drain().finally(() => { writing = undefined; });
    }
    return writing;
  }
  return {
    get enabled() { return enabled && !failed && !disposed; },
    setEnabled(value: boolean): void {
      if (disposed || value === enabled) return;
      enabled = value; generation++; pending = []; failed = false;
      if (value) { captureId = crypto.randomUUID(); sequence = 0; host.recovered(); }
    },
    append(record: TranscriptLogRecord): void {
      if (!enabled || failed || disposed) return;
      try {
        pending.push(JSON.stringify({ ...record, schemaVersion: 1, timestamp: new Date().toISOString(), captureId, sequence: ++sequence }));
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(() => { scheduled = false; void flush(); });
        }
      } catch (error) { fail(error); }
    },
    flush,
    dispose(): void { void flush(); disposed = true; generation++; pending = []; },
  };
}
