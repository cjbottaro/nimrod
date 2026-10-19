import type { ConversationState, DisplayMessage, ContentBlock, JsonRecord } from "./types";
export { renderParallelToolCard } from './parallel-card';

export interface ParallelTool {
  id: string;
  name: string;
  arguments?: unknown;
  parentToolCallId?: string;
  status: "running" | "done" | "failed" | "stopped";
}

export interface ParallelToolCluster {
  id: string;
  tools: ParallelTool[];
}

export interface ToolProgress {
  active: ParallelTool[];
  processingToolId?: string;
  interrupted: string[];
  parallel?: ParallelToolCluster;
}

/** Preserve stable row identities even when one assistant message contains several tools. */
export function transcriptRows(messages: DisplayMessage[]): DisplayMessage[] {
  return messages.flatMap(message => {
    if (message.role === "tool" && message.toolCallId) return [{ ...message, key: `tool:${message.toolCallId}` }];
    if (message.role !== "assistant" || !Array.isArray(message.content)) return [message];
    return message.content.flatMap((block, index) => {
      if (block.type === "text" && !block.text?.trim() || block.type === "thinking" && !block.thinking?.trim()) return [];
      const key = block.type === "toolCall" && block.id ? `tool:${block.id}` : `${message.key}:${block.type}:${index}`;
      return [{ ...message, key, content: [block] }];
    });
  });
}

/** Shared by full and dirty-row projection; progress never changes canonical history. */
export function projectToolRow(message: DisplayMessage, progress?: ToolProgress): DisplayMessage {
  const id = message.key.startsWith("tool:") ? message.key.slice(5) : undefined;
  const uiPhase = id && progress?.interrupted.includes(id) ? "stopped" as const
    : id && progress?.processingToolId === id ? "thinking" as const : undefined;
  if (!uiPhase) return message;
  if (message.role === "tool") return { ...message, uiPhase };
  return { ...message, content: (message.content as ContentBlock[]).map(block => ({ ...block, uiPhase })) };
}

/** Full projection alone owns structural parallel-overview placement. */
export function projectToolTimeline(messages: DisplayMessage[], progress?: ToolProgress, sourceRows = transcriptRows(messages)): DisplayMessage[] {
  const rows = sourceRows.map(message => projectToolRow(message, progress));
  const cluster = progress?.parallel;
  if (!cluster) return rows;
  const positions = new Map(rows.map((row, index) => [row.key, index]));
  const index = Math.max(...cluster.tools.map(tool => positions.get(`tool:${tool.id}`) ?? -1));
  return index < 0 ? rows : rows.flatMap((row, rowIndex) => rowIndex === index
    ? [row, { key: cluster.id, role: "parallel", parallelCluster: cluster }]
    : [row]);
}

function hasNextOutput(previous: ConversationState, next: ConversationState): boolean {
  const old = new Map(transcriptRows(previous.messages).map(row => [row.key, row]));
  return transcriptRows(next.messages).some(row => {
    if (row.role !== "assistant" || !Array.isArray(row.content)) return false;
    const before = old.get(row.key);
    if (!before) return true;
    const block = row.content[0];
    const oldBlock = Array.isArray(before.content) ? before.content[0] : undefined;
    return block.type === "text" && block.text !== oldBlock?.text || block.type === "thinking" && block.thinking !== oldBlock?.thinking;
  });
}

/** A live cluster supplements ordinary cards only while their execution intervals overlap. */
export function updateToolProgress(previous: ConversationState, next: ConversationState, event: JsonRecord): ToolProgress | undefined {
  const progress = previous.toolProgress || { active: [], interrupted: [] };
  const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
  if (event.type === "tool_execution_start" && id) {
    if (progress.active.some(tool => tool.id === id)) return previous.toolProgress;
    const tool: ParallelTool = { id, name: typeof event.toolName === "string" ? event.toolName : "tool", arguments: event.args, ...(typeof event.parentToolCallId === "string" && event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}), status: "running" };
    const active = [...progress.active, tool];
    const roots = active.filter(tool => !tool.parentToolCallId);
    const parallel = tool.parentToolCallId ? progress.parallel : progress.parallel
      ? { ...progress.parallel, tools: [...progress.parallel.tools, tool] }
      : roots.length > 1 ? { id: `parallel:${id}`, tools: roots } : undefined;
    return { ...progress, active, parallel, processingToolId: undefined, interrupted: progress.interrupted.filter(value => value !== id) };
  }
  if (event.type === "tool_execution_end" && id) {
    const active = progress.active.filter(tool => tool.id !== id);
    const parallel = progress.parallel && active.some(tool => !tool.parentToolCallId)
      ? { ...progress.parallel, tools: progress.parallel.tools.map(tool => tool.id === id ? { ...tool, status: event.isError === true ? "failed" as const : "done" as const } : tool) }
      : undefined;
    return { ...progress, active, parallel, processingToolId: !event.parentToolCallId && active.length === 0 && event.isError !== true && next.busy ? id : undefined };
  }
  if (event.type === "agent_settled" || event.type === "process_error") {
    if (!previous.toolProgress) return undefined;
    return { ...progress, active: [], parallel: undefined, processingToolId: undefined, interrupted: [...new Set([...progress.interrupted, ...progress.active.map(tool => tool.id)])] };
  }
  if (progress.processingToolId && ["message_start", "message_update", "message_end"].includes(String(event.type))) {
    const message = event.message as JsonRecord | undefined;
    if (hasNextOutput(previous, next) || message?.role === "assistant" && ["error", "aborted"].includes(String(message.stopReason))) {
      return { ...progress, processingToolId: undefined };
    }
  }
  return previous.toolProgress;
}
