import type { CardPluginContext, ToolCardData, CardPluginTarget } from './card-plugin-api';
import type { ComposerKeyboardEvent, KeyboardSubmissionMode } from './pi/composer-dom';
import type { SlashCommand } from './pi/slash-completion';
import type { SteeringStatus } from './pi/steering-transcript';
import type { ParallelToolCluster } from './pi/tool-progress';
import type { StatusAreaSnapshot } from './status-area';

export interface ConversationViewState {
  configurationOperations?: readonly import('./session-configuration').ConfigurationOperation[];
  deletionLocked?: boolean;
  messages?: RenderMessage[];
  busy?: boolean;
  status?: string;
  sessionUnavailable?: boolean;
  recoveryNotice?: string;
  inputLocked?: boolean;
  statusArea?: StatusAreaSnapshot;
  /** Optional queue presentation supplied only by integrations with real queue semantics. */
  queue?: { steering?: string[]; followUp?: string[]; authoritative?: boolean; pendingCount?: number; unavailableLabel?: string };
}
export type PreparedSubmission =
  | { kind: 'reject'; error: string }
  | { kind: 'local'; message: Record<string, unknown> }
  | { kind: 'request'; message: Record<string, unknown>; preview: boolean; navigate: boolean };
export interface ConversationInteraction {
  readonly label: string;
  readonly unsupportedImages?: string;
  commands(raw: unknown): SlashCommand[];
  keyboardMode(event: ComposerKeyboardEvent, busy: boolean): KeyboardSubmissionMode | undefined;
  prepare(text: string, state: ConversationViewState): PreparedSubmission;
  composer(state: ConversationViewState): { hint: string; stopLabel: string };
  /** Optional harness-owned user-content presentation (e.g. Pi skill disclosures). */
  userText?(document: Document, text: string, key: string, expanded: Map<string, boolean>,
    markdown: (text: string) => HTMLElement, previous?: HTMLElement): HTMLElement | undefined;
}
export interface ConversationView {
  setActive(active: boolean): void; scrollToBottom(): void; dispose(): void;
  /** Error presentation ownership only; never used to infer transport/delivery state. */
  hasConnectionOutcome?(): boolean;
}
export interface ConversationViewHost {
  /** Stable owning-project display context, independent of harness-reported tool paths. */
  projectDirectory?: string;
  interaction: ConversationInteraction;
  performance?: import('./performance-diagnostics').PerformanceProbe;
  cardRenderer?: (data: Readonly<import('./card-plugin-api').ToolCardData>) => import('./pi/tool-card').ToolCardRenderer;
  cardActions?: Pick<CardPluginContext, 'copy' | 'openLink'> & { popOutCode(text: string, language: string): Promise<void> };
  attachments?: import('./pi/image-attachments').AttachmentHost;
  reportNotice?(notice: import('./application-notices').ApplicationNotice): void;
  resolveNotice?(id: string): void;
  resolveNoticeCause?(cause: string): void;
  promptSubmitted?(): void;
  sendAutoFollow?(): import('./pi/transcript-scroll').SendAutoFollow;
  postMessage(message: Record<string, unknown>): void;
  onMessage(listener: (message: ConversationViewMessage) => void): void;
  getState(): unknown;
  setState(value: unknown): void;
}

export interface ConversationViewMessage {
  type?: string;
  key?: string;
  build?: string;
  locked?: boolean;
  commands?: unknown;
  state?: ConversationViewState;
  transcript?: { base: number; revision: number; rows?: readonly RenderMessage[] };
  restore?: unknown;
  composerState?: unknown;
  text?: unknown;
  id?: string;
  customInstructions?: unknown;
  title?: unknown;
  prefill?: unknown;
  success?: boolean;
  outcome?: "accepted" | "rejected" | "cancelled" | "unknown";
  error?: unknown;
  noticeCause?: string;
  operation?: string;
  steering?: unknown;
  followUp?: unknown;
}

export interface RenderBlock extends ToolCardData {
  type?: unknown;
  data?: unknown;
  mimeType?: unknown;
  text?: unknown;
  thinking?: unknown;
  thinkingComplete?: boolean;
  uiPhase?: "thinking" | "stopped";
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  executionOutput?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: "running" | "finished" | "result";
}

export interface RenderMessage {
  operation?: import('./operation-card').OperationCard;
  configurationOperation?: import('./session-configuration').ConfigurationOperation;
  steeringStatus?: SteeringStatus;
  steering?: boolean;
  queued?: boolean;
  sticky?: boolean;
  uiPhase?: "thinking" | "stopped";
  key?: string;
  role?: string;
  originLabel?: string;
  parallelCluster?: ParallelToolCluster;
  content?: unknown | RenderBlock[];
  toolCallId?: string;
  toolName?: string;
  toolSource?: CardPluginTarget;
  toolTitle?: string;
  toolKind?: string;
  toolNative?: unknown;
  toolArguments?: unknown;
  isError?: boolean;
  output?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  toolStatus?: "running" | "finished" | "result";
}
