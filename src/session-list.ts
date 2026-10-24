import type { SavedSessionIdentity } from './session-lifecycle';

export type SessionStatus =
  | 'closed' | 'inactive' | 'starting' | 'ready' | 'working' | 'input'
  | 'failed' | 'unread' | 'sending' | 'compacting' | 'restarting'
  | 'closing' | 'deleting' | 'recovery';

/** Shared list projection, not a connection owner or a second session state machine. */
export interface SessionListEntry {
  readonly key: string;
  readonly title: string;
  readonly harnessLabel: string;
  readonly timestamp?: number;
  readonly open: boolean;
  readonly status: SessionStatus;
  readonly reference?: SavedSessionIdentity;
  readonly keywords?: string;
}

export function savedSessionKey(reference: SavedSessionIdentity): string {
  return 'path' in reference ? `pi:${JSON.stringify([reference.path, reference.sessionId])}`
    : `${reference.kind}:${JSON.stringify(reference.sessionId)}`;
}

/** Open-session presentation is authoritative; history retains its search metadata. */
export function resolveSessionListEntry(saved: SessionListEntry, open: readonly SessionListEntry[]): SessionListEntry {
  const current = open.find(entry => entry.key === saved.key);
  return current ? { ...current, keywords: saved.keywords } : saved;
}
