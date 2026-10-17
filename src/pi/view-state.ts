import type { RenderMessage, ConversationViewMessage } from '../conversation-view-host';

export interface PiViewState {
  deletionLocked?: boolean;
  messages?: RenderMessage[];
  busy?: boolean;
  compacting?: boolean;
  status?: string;
  sessionName?: string;
  sessionFile?: string;
  temporary?: boolean;
  sessionUnavailable?: boolean;
  recoveryNotice?: string;
  sessionStats?: {
    cost?: number;
    context?: { tokens?: number | null; contextWindow?: number; percent?: number | null };
    autoCompactionEnabled?: boolean;
  };
  extensionStatuses?: Record<string, string>;
  extensionWidgets?: Record<string, { lines?: unknown[] }>;
  queue?: { steering?: string[]; followUp?: string[]; authoritative?: boolean; pendingCount?: number };
  modelControls?: {
    ready?: boolean;
    changing?: boolean;
    model?: { id?: unknown; provider?: unknown; name?: unknown } | null;
    thinkingLevel?: string;
    thinkingLevels?: string[];
  };
}

export type HostMessage = Omit<ConversationViewMessage, 'state'> & { state?: PiViewState };
