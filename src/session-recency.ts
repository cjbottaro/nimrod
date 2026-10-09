/** All's user-driven recency is independent of Pi activity and inbox arrival order. */
export function lastUsed(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000 ? value : 0;
}
export function recentSessions<T extends { lastUsed: number }>(sessions: readonly T[]): T[] {
  // Stable ties retain open order, including layouts predating lastUsed.
  return [...sessions].sort((a, b) => lastUsed(b.lastUsed) - lastUsed(a.lastUsed));
}
export function nextLastUsed(sessions: readonly { lastUsed: number }[], now = Date.now()): number {
  const previous = sessions.reduce((latest, session) => Math.max(latest, lastUsed(session.lastUsed)), 0);
  return Math.max(lastUsed(now), Math.min(8_640_000_000_000_000, previous + 1));
}

export interface RecencyIdentity { path: string; sessionId: string; }
/** Closed sessions retain only identity + recency, never conversation content. */
export class SessionRecency {
  private entries = new Map<string, { sessionId: string; lastUsed: number }>();
  constructor(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [path, value] of Object.entries(raw)) {
      const entry = value as { sessionId?: unknown; lastUsed?: unknown } | null;
      if (path && entry && typeof entry.sessionId === 'string' && entry.sessionId && lastUsed(entry.lastUsed)) {
        this.entries.set(path, { sessionId: entry.sessionId, lastUsed: lastUsed(entry.lastUsed) });
      }
    }
  }
  get(identity: RecencyIdentity): number {
    const entry = this.entries.get(identity.path);
    return entry?.sessionId === identity.sessionId ? entry.lastUsed : 0;
  }
  record(identity: RecencyIdentity, timestamp: unknown): boolean {
    const used = lastUsed(timestamp);
    if (!identity.path || !identity.sessionId || !used || used <= this.get(identity)) return false;
    this.entries.set(identity.path, { sessionId: identity.sessionId, lastUsed: used });
    return true;
  }
  delete(files: readonly string[]): boolean {
    let changed = false;
    for (const file of files) if (this.entries.delete(file)) changed = true;
    return changed;
  }
  dump(): Record<string, { sessionId: string; lastUsed: number }> { return Object.fromEntries(this.entries); }
}

function scale(container: HTMLElement): number {
  return container.offsetHeight ? container.getBoundingClientRect().height / container.offsetHeight || 1 : 1;
}
/** Preserve a visible row, not merely scrollTop, when rows move above the viewport.
 * Exclude the deliberately moved row so sending never chases it to the top.
 * Rects are normalized to layout pixels for native zoom and fixture CSS zoom.
 */
export function captureSidebarScroll(container: HTMLElement, rows: readonly HTMLElement[], moved?: HTMLElement): () => void {
  const top = container.scrollTop, bounds = container.getBoundingClientRect(), zoom = scale(container);
  const anchors = rows.filter(row => row !== moved && !row.hidden).map(row => ({ row, rect: row.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > bounds.top && rect.top < bounds.bottom)
    .map(({ row, rect }) => ({ row, offset: (rect.top - bounds.top) / zoom }));
  return () => {
    const anchor = anchors.find(({ row }) => row.isConnected && !row.hidden);
    if (anchor) container.scrollTop += (anchor.row.getBoundingClientRect().top - container.getBoundingClientRect().top) / scale(container) - anchor.offset;
    else container.scrollTop = top;
  };
}
/** Reveal only for explicit navigation; never scroll other ancestors/transcripts. */
export function revealSidebarRow(container: HTMLElement, row: HTMLElement): void {
  if (!container.offsetHeight || row.hidden) return;
  const bounds = container.getBoundingClientRect(), rect = row.getBoundingClientRect(), zoom = scale(container);
  if (rect.top < bounds.top) container.scrollTop += (rect.top - bounds.top) / zoom;
  else if (rect.bottom > bounds.bottom) container.scrollTop += (rect.bottom - bounds.bottom) / zoom;
}
