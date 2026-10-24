import type { ConversationInteraction, ConversationViewState } from './conversation-view-host';
import type { SessionLifecycle, SavedSessionIdentity, LaunchMode } from './session-lifecycle';
import type { SessionMessageInput } from './session-message-input';
import type { SessionConfiguration } from './session-configuration';
import type { SessionHistory } from './session-history';
import type { SessionDeletionContext, SessionDeletionSource } from './session-deletion-operation';
import type { ActionId } from './keybindings';
import type { HarnessProjectHost, HarnessSessionHost } from './harness-host';

export type SessionRequest =
  | { mode: 'saved' | 'temporary'; initialName?: string }
  | { mode: 'resume'; reference: SavedSessionIdentity };
export interface SessionMetadata { title: string; lastUsed: number; pinned?: boolean; }
export interface PreparedSession extends SessionMetadata { request: Extract<SessionRequest, { mode: 'resume' }>; }
export interface HarnessActionMetadata { id: ActionId; label: string; detail: string; keywords?: string; }
/** Private presentation metadata becomes executable only inside a concrete adapter. */
export interface HarnessActionContribution extends HarnessActionMetadata { run?: () => Promise<void>; }
/** An advertised action must have an executable implementation or a concrete configuration target. */
export type HarnessAction = HarnessActionMetadata & (
  | { run(): Promise<void>; configurationSetting?: never }
  | { configurationSetting: string; run?: never }
);
export interface SessionPresentation {
  harnessLabel: string; badge: string; badgeTitle: string;
  busy: boolean; working: boolean; pending: boolean; compacting: boolean;
  queuePending: boolean; destructiveBusy: boolean;
}
export interface SessionConversation {
  readonly interaction: ConversationInteraction;
  readonly messageInput: SessionMessageInput;
  readonly state: ConversationViewState | undefined;
  handle(message: Record<string, unknown>): Promise<void>;
}
export type SessionRestart =
  | { supported: false; reason: string }
  | { supported: true; available(): boolean; reason(): string; detail: string; confirmation: string; needsConfirmation(inputPending: boolean): boolean; run(): Promise<void> };
export interface SessionClosePolicy {
  readonly alwaysConfirm: boolean;
  readonly label: string;
  readonly message: string;
}
export interface SessionSelectionPolicy {
  readonly deferRestored: boolean;
  releasesDeferral(intent: import('./session-navigation').SelectionIntent): boolean;
}
export interface SessionInteractions { setActive(active: boolean): void; dispose(): void; }

/** Required application ports. No concrete controller, protocol, shell Tab or backend union.
 * Optional features still occupy an explicit slot: use a named honest default.
 */
export interface HarnessSession {
  readonly lifecycle: SessionLifecycle;
  readonly conversation: SessionConversation;
  readonly presentation: { snapshot(): SessionPresentation };
  readonly configuration: { current(): SessionConfiguration | undefined };
  readonly actions: { current(): readonly HarnessAction[]; control(id: string): Promise<void> };
  readonly restart: SessionRestart;
  readonly close: SessionClosePolicy;
  readonly drafts: { readonly durability: 'persistent' | 'memory' };
  readonly selection: SessionSelectionPolicy;
  readonly interactions: SessionInteractions;
  /** Compatibility binding for native file-backed reference windows, not conversation identity. */
  readonly references: { file(): { path: string; sessionId: string } | undefined };
}

export interface HarnessSavedSessions {
  accepts(reference: SavedSessionIdentity): boolean;
  key(reference: SavedSessionIdentity): string;
  draftScope(reference: SavedSessionIdentity): string;
  prepare(reference: SavedSessionIdentity, metadata: SessionMetadata, restoring: boolean): Promise<PreparedSession>;
  blocked(key?: string): boolean;
  locked(key?: string): boolean;
  removed(key?: string): boolean;
  last(): { project: string; reference: SavedSessionIdentity } | undefined;
}
export interface HarnessHistory {
  source(): SessionHistory | undefined;
  /** Mark project association on explicit use/restored membership, never start a conversation. */
  associate(): void;
  dispose(): Promise<void>;
}
export interface HarnessCreation {
  readonly action: HarnessActionMetadata | undefined;
  readonly title: string;
  readonly defaultMode: Exclude<LaunchMode, 'resume'>;
  readonly modes: readonly Exclude<LaunchMode, 'resume'>[];
  readonly named: boolean;
}
export interface HarnessProject {
  readonly id: string;
  readonly label: string;
  readonly creation: HarnessCreation;
  readonly initialization: { readonly blocking: boolean; run(): Promise<void>; ready(): boolean };
  readonly saved: HarnessSavedSessions;
  readonly history: HarnessHistory;
  deletion(context: SessionDeletionContext): SessionDeletionSource;
  create(host: HarnessSessionHost, request: SessionRequest): HarnessSession;
  dispose(): void;
}
export interface HarnessRegistration {
  readonly id: string;
  readonly label: string;
  readonly creation: HarnessCreation;
  readonly cards: import('./card-renderers').HarnessCardRenderer;
  readonly actions: readonly (HarnessActionMetadata & { context: 'project' | 'session' })[];
  create(host: HarnessProjectHost): HarnessProject;
}
