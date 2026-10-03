export type JsonRecord = Record<string, unknown>;

export interface NativeSessionStats {
  cost?: number;
  context?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
  autoCompactionEnabled?: boolean;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  thinkingComplete?: boolean;
  uiPhase?: "thinking" | "stopped";
  id?: string;
  name?: string;
  arguments?: unknown;
  executionOutput?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: "running" | "finished" | "result";
}

export interface AgentMessage {
  role: string;
  content?: string | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
  [key: string]: unknown;
}

export interface DisplayMessage {
  key: string;
  role: string;
  parallelCluster?: import("./tool-progress").ParallelToolCluster;
  uiPhase?: "thinking" | "stopped";
  content?: string | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
  streaming?: boolean;
  output?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  toolStatus?: "running" | "finished" | "result";
}

export interface ExtensionWidget {
  lines: string[];
  placement?: "aboveEditor" | "belowEditor";
}

export interface QueueDisplayState {
  steering: string[];
  followUp: string[];
  authoritative: boolean;
  pendingCount?: number;
}

export interface ModelControlState {
  ready: boolean;
  changing: boolean;
  model: { id: string; provider: string; name?: string } | null;
  thinkingLevel?: string;
  thinkingLevels: string[];
}

export interface ConversationState {
  messages: DisplayMessage[];
  busy: boolean;
  compacting?: boolean;
  status: string;
  sessionStats?: NativeSessionStats;
  toolProgress?: import("./tool-progress").ToolProgress;
  modelControls: ModelControlState;
  extensionStatuses: Record<string, string>;
  extensionWidgets: Record<string, ExtensionWidget>;
  queue: QueueDisplayState;
  sessionName?: string;
  sessionFile?: string;
  temporary?: boolean;
  sessionUnavailable?: boolean;
  recoveryNotice?: string;
}
