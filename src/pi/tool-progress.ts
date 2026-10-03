import type { ConversationState, DisplayMessage, ContentBlock, JsonRecord } from "./types";
import { toolInputPreview } from "./tool-card";

export interface ParallelTool {
  id: string;
  name: string;
  arguments?: unknown;
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

/** Progress is presentation state; Pi's actual execution statuses and history remain untouched. */
export function projectToolTimeline(messages: DisplayMessage[], progress?: ToolProgress): DisplayMessage[] {
  const rows = transcriptRows(messages).map(message => {
    const id = message.key.startsWith("tool:") ? message.key.slice(5) : undefined;
    const uiPhase = id && progress?.interrupted.includes(id) ? "stopped" as const
      : id && progress?.processingToolId === id ? "thinking" as const : undefined;
    if (!uiPhase) return message;
    if (message.role === "tool") return { ...message, uiPhase };
    return { ...message, content: (message.content as ContentBlock[]).map(block => ({ ...block, uiPhase })) };
  });
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
    const tool: ParallelTool = { id, name: typeof event.toolName === "string" ? event.toolName : "tool", arguments: event.args, status: "running" };
    const active = [...progress.active, tool];
    const parallel = progress.parallel
      ? { ...progress.parallel, tools: [...progress.parallel.tools, tool] }
      : active.length > 1 ? { id: `parallel:${id}`, tools: active } : undefined;
    return { ...progress, active, parallel, processingToolId: undefined, interrupted: progress.interrupted.filter(value => value !== id) };
  }
  if (event.type === "tool_execution_end" && id) {
    const active = progress.active.filter(tool => tool.id !== id);
    const parallel = progress.parallel && active.length
      ? { ...progress.parallel, tools: progress.parallel.tools.map(tool => tool.id === id ? { ...tool, status: event.isError === true ? "failed" as const : "done" as const } : tool) }
      : undefined;
    return { ...progress, active, parallel, processingToolId: active.length === 0 && event.isError !== true && next.busy ? id : undefined };
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

/** Compact live-only overview; completed rows sort above running rows. */
export function renderParallelToolCard(document: Document, cluster: ParallelToolCluster, details = document.createElement("details")): HTMLDetailsElement {
  let summary = Array.from(details.children).find((child): child is HTMLElement => child.tagName === "SUMMARY");
  let list = Array.from(details.children).find((child): child is HTMLUListElement => child.tagName === "UL" && child.classList.contains("parallel-tool-list"));
  let indicator = summary?.querySelector<HTMLElement>(".parallel-indicator");
  let title = summary?.querySelector<HTMLElement>(".parallel-title");
  if (!indicator || !title || !summary || !list) {
    // A render may resume against an interrupted/partial card. Restore the shell
    // in place rather than letting a missing child break the entire transcript.
    details.replaceChildren();
    details.className = "tool-card parallel-tool-card";
    details.open = true;
    summary = document.createElement("summary");
    const row = document.createElement("span"); row.className = "tool-card-summary";
    indicator = document.createElement("span"); indicator.className = "parallel-indicator"; indicator.setAttribute("aria-hidden", "true");
    title = document.createElement("span"); title.className = "parallel-title";
    row.append(indicator, title); summary.append(row);
    list = document.createElement("ul"); list.className = "parallel-tool-list";
    details.append(summary, list);
  }
  const running = cluster.tools.some(tool => tool.status === "running");
  setIndicator(indicator, running ? "running" : "done");
  title.textContent = "Parallel tools";
  summary.setAttribute("aria-label", `Parallel tools — ${cluster.tools.filter(tool => tool.status === "running").length} running`);
  const ordered = [...cluster.tools].sort((left, right) => (left.status === "running" ? 1 : 0) - (right.status === "running" ? 1 : 0));
  ordered.forEach((tool, index) => {
    let row = Array.from(list.children).find(child => (child as HTMLElement).dataset.toolId === tool.id) as HTMLElement | undefined;
    if (!row) {
      row = document.createElement("li"); row.dataset.toolId = tool.id; row.className = "parallel-tool-row";
      const indicator = document.createElement("span"); indicator.className = "member-indicator"; indicator.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.className = "tool-card-title";
      const preview = document.createElement("span"); preview.className = "tool-card-preview";
      row.append(indicator, name, preview);
    }
    setIndicator(row.querySelector<HTMLElement>(".member-indicator")!, tool.status);
    row.querySelector(".tool-card-title")!.textContent = tool.name;
    row.querySelector(".tool-card-preview")!.textContent = toolInputPreview(tool.name, tool.arguments) || "";
    const at = list.children[index];
    if (at !== row) list.insertBefore(row, at || null);
  });
  return details;
}

function setIndicator(node: HTMLElement, status: ParallelTool["status"]): void {
  // Keep the semantic identity class used by the incremental renderer.
  node.classList.remove("tool-card-spinner", "tool-card-dot", "tool-card-succeeded", "tool-card-failed");
  if (status === "running") node.classList.add("tool-card-spinner");
  else if (status === "done") node.classList.add("tool-card-dot", "tool-card-succeeded");
  else if (status === "failed") node.classList.add("tool-card-dot", "tool-card-failed");
  else node.classList.add("tool-card-dot");
}
