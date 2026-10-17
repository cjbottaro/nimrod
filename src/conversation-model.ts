/** Shared immutable transcript records, not a harness protocol or execution schema. */
export interface ContentBlock {
  type: string;
  source?: import('./card-plugin-api').CardPluginTarget;
  title?: string;
  kind?: string;
  native?: unknown;
  data?: string;
  mimeType?: string;
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

export interface DisplayMessage {
  key: string;
  role: string;
  originLabel?: string;
  parallelCluster?: import("./pi/tool-progress").ParallelToolCluster;
  /** Parsed, core-owned immutable inputs for standalone tool envelopes. */
  toolArguments?: unknown;
  uiPhase?: "thinking" | "stopped";
  content?: string | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  toolSource?: import('./card-plugin-api').CardPluginTarget;
  toolTitle?: string;
  toolKind?: string;
  toolNative?: unknown;
  isError?: boolean;
  timestamp?: number;
  streaming?: boolean;
  output?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  toolStatus?: "running" | "finished" | "result";
}
