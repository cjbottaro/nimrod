import type { ConnectionEligibility } from './session-connection';
import { savedDraftScope } from './draft-scope';
import { lastUsed } from './session-recency';

export type LaunchMode = 'saved' | 'temporary' | 'resume';
export type SavedSessionIdentity =
  | { path: string; sessionId: string }
  | { kind: string; sessionId: string };
export type SavedSidebarSession = SavedSessionIdentity & { name: string; lastUsed: number; pinned?: boolean };
/** A previously accepted user action may outlive the palette/settings surface that accepted it. */
export interface ConnectSessionOptions { acceptedAction?: boolean; }
export type SessionConnectionState = 'disconnected' | 'connecting' | 'connected';

/** Read-only bookkeeping for the project layout and draft store; never harness history. */
export interface SessionPersistence {
  readonly identity: SavedSessionIdentity | undefined;
  readonly key: string | undefined;
  readonly draftScope: string | undefined;
}

/** Connection coordinator and shell teardown port, not prompt cancellation or history discovery. */
export interface SessionConnectivity {
  readonly label: string;
  readonly connection: SessionConnectionState;
  /** Selection eligibility, not permission to create a new session or a readiness acknowledgement. */
  eligibility(): ConnectionEligibility;
  /** Settles when the guarded attempt finishes, including a skipped or locally reported failure.
   * Read connection state for readiness. Never submits/replays a prompt or navigates on completion.
   */
  connect(options?: ConnectSessionOptions): Promise<void>;
  /** Observe owned child exit; concurrent calls for one token share work. Failure retains ownership
   * and permits a later explicit retry. This is not the composer's Stop/cancel-turn action.
   */
  stop(): Promise<void>;
  /** Synchronously retire local transport/pending operations. Does not itself await native exit;
   * concrete disconnect observers may request stop. Saved identity/drafts remain intact.
   */
  disconnect(reason: string): void;
}

/** Composition convenience, not a growing universal harness controller. */
export interface SessionLifecycle extends SessionPersistence, SessionConnectivity {}

/** Only process/connection bookkeeping is shared; concrete integrations own their identity inputs. */
export interface SessionLifecycleOwner {
  token?: string;
  starting: boolean;
  ended: boolean;
}
export interface SessionLifecycleHost {
  connect(options: ConnectSessionOptions): Promise<void>;
  stop(token: string): Promise<void>;
  gate(): 'ready' | 'blocked' | 'unavailable';
}

export function sessionConnectionState(owner: Pick<SessionLifecycleOwner, 'starting' | 'ended'>, available: boolean): SessionConnectionState {
  return owner.starting ? 'connecting' : !owner.ended && available ? 'connected' : 'disconnected';
}

/** Token-bound teardown also serves retired attempts: late cleanup must never stop a replacement.
 * Keep completed work for this owner's lifetime; failed work permits an explicit retry.
 */
export function ownedProcessStop(stop: SessionLifecycleHost['stop']): (token: string) => Promise<void> {
  const pending = new Map<string, Promise<void>>();
  return async token => {
    let task = pending.get(token);
    if (!task) { task = (async () => stop(token))(); pending.set(token, task); }
    try { await task; }
    catch (error) { if (pending.get(token) === task) pending.delete(token); throw error; }
  };
}

/** Keep the reservation after a failed stop; deduplicate repeated teardown for one owned token. */
export function ownedSessionStop(owner: () => Pick<SessionLifecycleOwner, 'token'>, stop: SessionLifecycleHost['stop']): () => Promise<void> {
  const stopToken = ownedProcessStop(stop);
  return async () => { const token = owner().token; if (token) await stopToken(token); };
}

export function readSavedSidebarSession(value: unknown): SavedSidebarSession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const entry = value as Record<string, unknown>;
  if (typeof entry.sessionId !== 'string' || !entry.sessionId.trim()) return;
  const metadata = { name: typeof entry.name === 'string' ? entry.name : 'Session',
    lastUsed: lastUsed(entry.lastUsed), ...(entry.pinned === true ? { pinned: true } : {}) };
  if (typeof entry.kind === 'string') {
    try { savedDraftScope(entry.kind, entry.sessionId); } catch { return; }
    return { kind: entry.kind, sessionId: entry.sessionId, ...metadata };
  }
  if (entry.kind === undefined && typeof entry.path === 'string') {
    return { path: entry.path, sessionId: entry.sessionId, ...metadata };
  }
}
