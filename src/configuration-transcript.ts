import type { RenderMessage } from './conversation-view-host';
import type { ConfigurationOperation } from './session-configuration';

interface Entry { operation: ConfigurationOperation; row: RenderMessage; anchor?: string; anchored: boolean; }
const pending = (operation: ConfigurationOperation) => operation.phase === 'queued' || operation.phase === 'applying';
/** Local presentation only: never enters harness history, prompt payloads or draft persistence. */
export class ConfigurationTranscript {
  private source?: readonly ConfigurationOperation[];
  private entries = new Map<string, Entry>();
  sync(operations?: readonly ConfigurationOperation[]): { structural: boolean; rows: RenderMessage[] } {
    if (this.source === operations) return { structural: false, rows: [] };
    this.source = operations;
    let structural = false;
    const rows: RenderMessage[] = [], keys = new Set<string>();
    for (const operation of operations || []) {
      keys.add(operation.key);
      const before = this.entries.get(operation.key);
      if (before?.operation === operation) continue;
      const sticky = pending(operation);
      if (!before || before.row.sticky !== sticky) structural = true;
      const row: RenderMessage = { key: operation.key, role: 'configuration', configurationOperation: operation, sticky };
      this.entries.set(operation.key, { operation, row, anchor: before?.anchor, anchored: !sticky && before?.row.sticky === false ? before.anchored : false });
      rows.push(row);
    }
    for (const key of this.entries.keys()) if (!keys.has(key)) { this.entries.delete(key); structural = true; }
    return { structural, rows };
  }
  project(messages: RenderMessage[]): RenderMessage[] {
    if (!this.entries.size) return messages;
    let tail: string | undefined;
    for (let index = messages.length - 1; index >= 0; index--) if (!messages[index].sticky) { tail = messages[index].key; break; }
    const anchored = new Map<string | undefined, RenderMessage[]>(), sticky: RenderMessage[] = [];
    for (const entry of this.entries.values()) {
      if (entry.row.sticky) { sticky.push(entry.row); continue; }
      if (!entry.anchored) { entry.anchor = tail; entry.anchored = true; }
      const rows = anchored.get(entry.anchor) || []; rows.push(entry.row); anchored.set(entry.anchor, rows);
    }
    const result: RenderMessage[] = [];
    for (const message of messages) {
      result.push(message);
      if (anchored.has(message.key)) { result.push(...anchored.get(message.key)!); anchored.delete(message.key); }
    }
    // An anchor can disappear after compaction/history replacement. Keep local
    // operation evidence, rather than persisting it into the harness transcript.
    const trailing = [...anchored.values()].flat();
    const firstSticky = result.findIndex(message => message.sticky);
    result.splice(firstSticky < 0 ? result.length : firstSticky, 0, ...trailing);
    return [...result, ...sticky];
  }
}
