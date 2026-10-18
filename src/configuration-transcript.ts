import type { RenderMessage } from './conversation-view-host';
import type { ConfigurationOperation } from './session-configuration';

// An undefined terminal anchor means the transcript was empty: before future rows.
interface Entry { operation: ConfigurationOperation; row: RenderMessage; anchor?: string; }
function transcriptTail(messages: RenderMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) if (!messages[index].sticky) return messages[index].key;
  return undefined;
}
const pending = (operation: ConfigurationOperation) => operation.phase === 'queued' || operation.phase === 'applying';
/** Local presentation only: never enters harness history, prompt payloads or draft persistence. */
export class ConfigurationTranscript {
  private source?: readonly ConfigurationOperation[];
  private entries = new Map<string, Entry>();
  get hasConnectionOutcome(): boolean { return this.source?.some(operation => operation.cause === 'connection') === true; }
  sync(operations: readonly ConfigurationOperation[] | undefined, messages: () => RenderMessage[]): { structural: boolean; rows: RenderMessage[] } {
    if (this.source === operations) return { structural: false, rows: [] };
    this.source = operations;
    let structural = false;
    let capturedTail = false, tail: string | undefined;
    const rows: RenderMessage[] = [], keys = new Set<string>();
    for (const operation of operations || []) {
      keys.add(operation.key);
      const before = this.entries.get(operation.key);
      if (before?.operation === operation) continue;
      const sticky = pending(operation);
      if (!before || before.row.sticky !== sticky) structural = true;
      const row: RenderMessage = { key: operation.key, role: 'configuration', configurationOperation: operation, sticky,
        operation: { title: operation.title, state: sticky ? 'pending' : operation.phase === 'completed' ? 'succeeded'
          : operation.phase === 'failed' ? 'failed' : operation.phase === 'unknown' ? 'unknown' : 'not-applied',
          details: operation.details, cancelId: operation.cancellable ? operation.key : undefined } };
      let anchor = before?.anchor;
      if (!sticky && (!before || before.row.sticky)) {
        // Observe the terminal boundary synchronously, not at the next (possibly
        // hidden/coalesced) paint. Pending/content-only updates never read history.
        if (!capturedTail) { tail = transcriptTail(messages()); capturedTail = true; }
        anchor = tail;
      }
      this.entries.set(operation.key, { operation, row, anchor });
      rows.push(row);
    }
    for (const key of this.entries.keys()) if (!keys.has(key)) { this.entries.delete(key); structural = true; }
    return { structural, rows };
  }
  project(messages: RenderMessage[]): RenderMessage[] {
    if (!this.entries.size) return messages;
    const keys = new Set(messages.map(message => message.key));
    const anchored = new Map<string | undefined, RenderMessage[]>(), sticky: RenderMessage[] = [];
    for (const entry of this.entries.values()) {
      if (entry.row.sticky) { sticky.push(entry.row); continue; }
      // If history removed an anchor, settle once at the remaining tail (or
      // start for empty history), rather than following every future append.
      if (entry.anchor !== undefined && !keys.has(entry.anchor)) entry.anchor = transcriptTail(messages);
      const rows = anchored.get(entry.anchor) || []; rows.push(entry.row); anchored.set(entry.anchor, rows);
    }
    const result: RenderMessage[] = [...(anchored.get(undefined) || [])];
    anchored.delete(undefined);
    for (const message of messages) {
      result.push(message);
      if (anchored.has(message.key)) { result.push(...anchored.get(message.key)!); anchored.delete(message.key); }
    }
    return [...result, ...sticky];
  }
}
