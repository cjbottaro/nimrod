import type { SessionLifecycleOwner, ConnectSessionOptions, SavedSessionIdentity } from './session-lifecycle';
import type { SessionDrafts } from './session-drafts';
import type { ConversationViewMessage } from './conversation-view-host';
import type { ApplicationNotice } from './application-notices';
import type { SessionListEntry } from './session-list';
import type { SessionRecency } from './session-recency';
import type { PerformanceProbe } from './performance-diagnostics';
import type { TranscriptLogSink } from './transcript-logs';
import type { Dialogs } from './dialogs';
import type { installCommandPalette } from './command-palette';

/** Construction/effect ports, not the application session model. */
export interface HarnessProjectHost {
  project(): string | undefined;
  current(): boolean;
  applicationReady(): boolean;
  deletionPending(): boolean;
  runtime(): Readonly<Record<string, string | undefined>>;
  store: { read(key: string): unknown; save(key: string, value: unknown): void };
  recency(): SessionRecency;
  open(): readonly SessionListEntry[];
  participants(): readonly HarnessDeletionParticipant[];
  drafts(): SessionDrafts;
  transcriptLog: TranscriptLogSink;
  changed(): void;
  notice(notice: ApplicationNotice): void;
  resolve(id: string): void;
}
export interface HarnessDeletionParticipant {
  readonly reference: SavedSessionIdentity | undefined;
  readonly token: string | undefined;
  readonly title: string;
  readonly busy: boolean;
  readonly hasDraft: boolean;
  lock(locked: boolean, executing?: boolean): void;
  failed(message: string): void;
}
export interface HarnessSessionLifetime {
  current(): boolean;
  selected(): boolean;
  settingsOpen(): boolean;
  closing(): boolean;
  restarting(): boolean;
  deleting(): boolean;
  available(options: ConnectSessionOptions): boolean;
  conflicts(reference: SavedSessionIdentity): boolean;
}
export interface HarnessSessionEffects {
  publish(message: ConversationViewMessage): void;
  title(): string;
  changed(change?: { title?: string; clearFailed?: boolean; persist?: boolean }): void;
  identified(): void;
  retire(): void;
  input(delta: number): void;
  attention(kind: 'completed' | 'failed' | 'input', token: string, label: string, response?: string, signal?: AbortSignal): void;
  notice(notice: Omit<ApplicationNotice, 'owner'>): void;
  resolve(id: string): void;
  connection(message: string, retry?: boolean, details?: string): void;
  hasConnectionOutcome(): boolean;
  storageFailure(error: unknown): void;
}
export interface HarnessInteractionHost {
  document: Document;
  root: HTMLElement;
  palette: Pick<ReturnType<typeof installCommandPalette>, 'startInspection' | 'startSelection' | 'startRetainedSelection'>;
  dialogs: Pick<Dialogs, 'choose' | 'input' | 'confirm' | 'cancel'>;
  canPresent(): boolean;
  focusComposer(): void;
  withDialog<T>(action: (title: string) => Promise<T>, title: string): Promise<T>;
}
export interface HarnessSessionHost {
  readonly id: string;
  readonly project: string;
  readonly ownership: SessionLifecycleOwner;
  readonly lifetime: HarnessSessionLifetime;
  readonly effects: HarnessSessionEffects;
  readonly ui: HarnessInteractionHost;
  readonly drafts: SessionDrafts;
  readonly performance: PerformanceProbe;
  readonly transcriptLog: TranscriptLogSink;
}
