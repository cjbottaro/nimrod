import type { ContentBlock, DisplayMessage } from "./types";

export interface ToolCallUpdate {
  id: string;
  name?: string;
  arguments?: unknown;
  executionOutput?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: ContentBlock["toolStatus"];
}

/** Standalone placement is only an envelope; cards always consume the same model. */
export function toolMessageBlock(message: Pick<DisplayMessage, "toolCallId" | "toolName" | "output" | "hasStreamingOutput" | "resultOutput" | "isError" | "toolStatus" | "uiPhase"> & { content?: unknown }): ContentBlock {
  let args: unknown = message.content;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { /* Keep non-JSON inputs intact. */ }
  }
  return {
    type: "toolCall", id: message.toolCallId, name: message.toolName, arguments: args,
    executionOutput: message.output, hasStreamingOutput: message.hasStreamingOutput,
    resultOutput: message.resultOutput, isError: message.isError,
    toolStatus: message.toolStatus, uiPhase: message.uiPhase,
  };
}

/** Merge partial information from either source without rewinding execution. */
export function mergeToolCall(block: ContentBlock, update: ToolCallUpdate): ContentBlock {
  const rank = { running: 1, finished: 2, result: 3 };
  const stale = !!block.toolStatus && !!update.toolStatus && rank[update.toolStatus] < rank[block.toolStatus];
  return {
    ...block, type: "toolCall", id: update.id,
    name: update.name && update.name !== "tool" ? update.name : block.name || update.name || "tool",
    ...(update.arguments !== undefined ? { arguments: update.arguments } : {}),
    ...(!stale && update.executionOutput !== undefined ? { executionOutput: update.executionOutput } : {}),
    ...(update.hasStreamingOutput ? { hasStreamingOutput: true } : {}),
    ...(update.resultOutput !== undefined ? { resultOutput: update.resultOutput } : {}),
    ...(!stale && update.isError !== undefined ? { isError: update.isError } : {}),
    ...(!stale && update.toolStatus ? { toolStatus: update.toolStatus } : {}),
  };
}
