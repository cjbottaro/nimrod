export interface AttentionEntry { id: string; needsAttention: boolean; }

/** Window-local inbox order, independent of open-session order and agent activity. */
export class SessionAttention {
  private order: string[] = [];

  reconcile(entries: AttentionEntry[], selected?: string): string[] {
    const open = new Set(entries.map(entry => entry.id));
    const needed = new Set(entries.filter(entry => entry.needsAttention).map(entry => entry.id));
    // A read/resolved entry stays in place while selected, but is not counted as
    // outstanding attention. Closing always removes it, even if selected.
    this.order = this.order.filter(id => open.has(id) && (needed.has(id) || id === selected));
    const retained = new Set(this.order);
    for (const entry of entries) {
      if (entry.needsAttention && !retained.has(entry.id)) {
        this.order.push(entry.id); retained.add(entry.id);
      }
    }
    return [...this.order];
  }
}
