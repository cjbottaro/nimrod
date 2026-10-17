import type { SessionListEntry } from './session-list';

export interface SessionHistoryPage {
  readonly entries: readonly SessionListEntry[];
  readonly nextCursor?: string;
  readonly warnings: readonly string[];
}

/** Project-bound discovery only. Every returned entry has a durable reference. */
export interface SessionHistory {
  readonly id: string;
  readonly label: string;
  list(options: { signal: AbortSignal; cursor?: string }): Promise<SessionHistoryPage>;
  dispose(): Promise<void>;
}

export interface SessionHistorySnapshot {
  readonly entries: readonly SessionListEntry[];
  readonly pending: readonly string[];
  readonly issues: readonly { source: string; label: string; message: string }[];
}

/** Cancel a consumer's wait, not the shared project-history connection. */
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('History request cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Keep each source's ordering and publish usable results without waiting for other sources. */
export async function loadSessionHistory(
  sources: readonly SessionHistory[], signal: AbortSignal, publish: (snapshot: SessionHistorySnapshot) => void,
): Promise<SessionHistorySnapshot> {
  const states = sources.map(source => ({ source, entries: new Map<string, SessionListEntry>(), warnings: [] as string[], pending: true }));
  const snapshot = (): SessionHistorySnapshot => ({
    entries: states.flatMap(state => [...state.entries.values()]),
    pending: states.filter(state => state.pending).map(state => state.source.label),
    issues: states.filter(state => state.warnings.length).map(state => ({ source: state.source.id, label: state.source.label, message: state.warnings.join('\n') })),
  });
  await Promise.all(states.map(async state => {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    try {
      do {
        signal.throwIfAborted();
        const page = await state.source.list({ signal, cursor });
        signal.throwIfAborted();
        for (const entry of page.entries) {
          if (!entry.reference) throw new Error('History source returned a session without a saved identity');
          state.entries.set(entry.key, entry);
        }
        state.warnings.push(...page.warnings);
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error('History source repeated a pagination cursor. The list may be incomplete.');
          cursors.add(cursor);
        }
        if (!signal.aborted) publish(snapshot());
      } while (cursor !== undefined);
    } catch (error) {
      if (!signal.aborted) state.warnings.push(String(error));
    } finally {
      state.pending = false;
      if (!signal.aborted) publish(snapshot());
    }
  }));
  signal.throwIfAborted();
  return snapshot();
}
