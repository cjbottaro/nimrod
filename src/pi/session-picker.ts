export interface SessionRow { file: string; title: string; detail: string; depth: number; }

export function sessionDetail(session: { lastEntryAt?: string; mtimeMs: number; messageCount: number }, now = Date.now()): string {
  const parsed = Date.parse(session.lastEntryAt || "");
  const time = Number.isFinite(parsed) ? parsed : session.mtimeMs;
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return `${age} • ${session.messageCount} ${session.messageCount === 1 ? "message" : "messages"} • ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(time))}`;
}

export function visibleSessionRows(rows: SessionRow[], query: string, collapsed: Set<string>): SessionRow[] {
  const search = query.trim().toLowerCase();
  const keep = new Set<number>();
  if (search) rows.forEach((row, i) => {
    if (!row.title.toLowerCase().includes(search)) return;
    keep.add(i);
    for (let j = i + 1; j < rows.length && rows[j].depth > row.depth; j++) keep.add(j);
    let depth = row.depth;
    for (let j = i - 1; j >= 0 && depth > 0; j--) if (rows[j].depth < depth) { keep.add(j); depth = rows[j].depth; }
  });
  let hiddenBelow = Infinity;
  return rows.filter((row, i) => {
    if (search) return keep.has(i);
    if (row.depth > hiddenBelow) return false;
    hiddenBelow = collapsed.has(row.file) ? row.depth : Infinity;
    return true;
  });
}
