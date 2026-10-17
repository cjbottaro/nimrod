import { abortable, type SessionHistory, type SessionHistoryPage } from '../session-history';
import { savedSessionKey, type SessionListEntry } from '../session-list';
import { lastUsed } from '../session-recency';
import type { SessionFile } from './session-file';

export interface PiSessionSummary {
  path: string; sessionId: string; name?: string; preview: string; modified: number;
  parentSession?: string | null; lastUserMessageAt?: number;
}

export interface PiHistoryHost {
  catalog(): Promise<{ sessions: PiSessionSummary[]; warnings: string[] }>;
  inspect(path: string): Promise<SessionFile>;
  open(): readonly SessionListEntry[];
  removed(path: string): boolean;
  recency(reference: { path: string; sessionId: string }): number;
}

/** Pi retains its own catalog, exact-file and top-level-history semantics. */
export class PiSessionHistory implements SessionHistory {
  readonly id = 'pi';
  readonly label = 'Pi';
  constructor(private host: PiHistoryHost) {}

  async list({ signal, cursor }: { signal: AbortSignal; cursor?: string }): Promise<SessionHistoryPage> {
    if (cursor !== undefined) throw new Error('Pi history does not use pagination cursors');
    signal.throwIfAborted();
    const result = await abortable(this.host.catalog(), signal);
    signal.throwIfAborted();
    const entries = new Map(result.sessions.filter(entry => !this.host.removed(entry.path)).map(entry => [entry.path, entry]));
    const warnings = result.warnings.map(path => `Could not read Pi session: ${path}. Use Refresh to retry.`);
    for (const open of this.host.open()) {
      const reference = open.reference;
      if (!reference || !('path' in reference) || this.host.removed(reference.path)) continue;
      let saved = entries.get(reference.path);
      if (!saved) {
        try {
          const info = await abortable(this.host.inspect(reference.path), signal);
          signal.throwIfAborted();
          if (info.sessionId !== reference.sessionId) throw new Error('The session file was replaced with a different session');
          saved = { ...reference, parentSession: info.parentSession, name: open.title, preview: '', modified: 0, lastUserMessageAt: info.lastUserMessageAt };
        } catch (error) {
          signal.throwIfAborted();
          warnings.push(`Could not read Pi session ${reference.path}: ${error}. Use Refresh to retry.`);
          continue;
        }
      }
      entries.set(saved.path, saved);
    }
    return {
      warnings,
      entries: [...entries.values()].filter(entry => !entry.parentSession && !this.host.removed(entry.path))
        .sort((a, b) => b.modified - a.modified).map<SessionListEntry>(entry => {
          const reference = { path: entry.path, sessionId: entry.sessionId };
          return {
            key: savedSessionKey(reference), reference, title: entry.name || entry.preview || 'Untitled session',
            harnessLabel: 'Pi', timestamp: Math.max(this.host.recency(reference), lastUsed(entry.lastUserMessageAt)) || undefined,
            status: 'closed', open: false, keywords: `${entry.path} ${entry.preview}`,
          };
        }),
    };
  }

  async dispose(): Promise<void> {}
}
