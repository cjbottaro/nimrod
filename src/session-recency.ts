/** All's user-driven recency is independent of Pi activity and inbox arrival order. */
export function lastUsed(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
export function recentSessions<T extends { lastUsed: number }>(sessions: readonly T[]): T[] {
  // Stable ties retain open order, including layouts predating lastUsed.
  return [...sessions].sort((a, b) => lastUsed(b.lastUsed) - lastUsed(a.lastUsed));
}
export function nextLastUsed(sessions: readonly { lastUsed: number }[], now = Date.now()): number {
  const previous = sessions.reduce((latest, session) => Math.max(latest, lastUsed(session.lastUsed)), 0);
  return Math.max(lastUsed(now), Math.min(Number.MAX_SAFE_INTEGER, previous + 1));
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
