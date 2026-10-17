import type { ConnectionEligibility } from './session-connection';
import { lastUsed } from './session-recency';

export interface SessionFile {
  path: string;
  sessionId: string;
  exists: boolean;
  parentSession?: string | null;
  lastUserMessageAt?: number;
}
export type LaunchMode = 'saved' | 'temporary' | 'resume';
export type SavedSessionIdentity =
  | { path: string; sessionId: string }
  | { kind: 'acp'; profile: 'copilot'; sessionId: string };
export type SavedSidebarSession = SavedSessionIdentity & { name: string; lastUsed: number };
export interface ConnectSessionOptions { copyDraft?: string; acceptedAction?: boolean; initialName?: string; }
export type SessionConnectionState = 'disconnected' | 'connecting' | 'connected';

/** Nimrod lifecycle only. Conversation, configuration and tool semantics stay backend-owned. */
export interface SessionLifecycle {
  readonly label: string;
  readonly identity: SavedSessionIdentity | undefined;
  readonly key: string | undefined;
  readonly draftScope: string | undefined;
  readonly connection: SessionConnectionState;
  readonly connectOnStartup: boolean;
  eligibility(): ConnectionEligibility;
  connect(options?: ConnectSessionOptions): Promise<void>;
  stop(): Promise<void>;
  disconnect(reason: string): void;
}
export interface SessionLifecycleOwner {
  mode: LaunchMode;
  file?: SessionFile;
  token?: string;
  starting: boolean;
  ended: boolean;
}
export interface SessionLifecycleHost {
  connect(options: ConnectSessionOptions): Promise<void>;
  stop(token: string): Promise<void>;
  gate(): 'ready' | 'blocked' | 'unavailable';
}

export function sessionConnectionState(owner: SessionLifecycleOwner, session: { state: { sessionUnavailable?: boolean } } | undefined): SessionConnectionState {
  return owner.starting ? 'connecting' : !owner.ended && session && !session.state.sessionUnavailable ? 'connected' : 'disconnected';
}

/** Keep the reservation after a failed stop; deduplicate repeated teardown for one owned token. */
export function ownedSessionStop(owner: () => SessionLifecycleOwner, stop: SessionLifecycleHost['stop']): () => Promise<void> {
  let pending: { token: string; task: Promise<void> } | undefined;
  return async () => {
    const token = owner().token;
    if (!token) return;
    if (!pending || pending.token !== token) pending = { token, task: stop(token) };
    const current = pending;
    try { await current.task; }
    catch (error) { if (pending === current) pending = undefined; throw error; }
  };
}

export function readSavedSidebarSession(value: unknown): SavedSidebarSession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entry = value as Record<string, unknown>;
  if (typeof entry.sessionId !== 'string' || !entry.sessionId.trim()) return;
  const metadata = { name: typeof entry.name === 'string' ? entry.name : entry.kind === 'acp' ? 'Copilot session' : 'Session',
    lastUsed: lastUsed(entry.lastUsed) };
  if (entry.kind === 'acp') {
    if (entry.profile === 'copilot') return { kind: 'acp', profile: 'copilot', sessionId: entry.sessionId, ...metadata };
  } else if (entry.kind === undefined && typeof entry.path === 'string') {
    return { path: entry.path, sessionId: entry.sessionId, ...metadata };
  }
}
