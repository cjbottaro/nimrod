import { AgentMessage, ContentBlock, ConversationState, DisplayMessage, ExtensionWidget, JsonRecord, NativeSessionStats } from "./types";

import { updateToolProgress } from "./tool-progress";
import { mergeToolCall as mergeToolBlock, toolMessageBlock, type ToolCallUpdate as ToolUpdate } from "./tool-call";

export const initialConversationState = (): ConversationState => ({
  messages: [],
  busy: false,
  status: "Starting Pi…",
  modelControls: { ready: false, changing: false, model: null, thinkingLevels: [] },
  extensionStatuses: {},
  extensionWidgets: {},
  queue: { steering: [], followUp: [], authoritative: false },
});

/** Extension UI state is independent from Pi's agent lifecycle and survives agent_settled. */
export function setExtensionStatus(state: ConversationState, key: string, text: string | undefined): ConversationState {
  const extensionStatuses = { ...state.extensionStatuses };
  if (text === undefined) delete extensionStatuses[key];
  else extensionStatuses[key] = text;
  return { ...state, extensionStatuses };
}

export function setSessionStats(state: ConversationState, sessionStats: NativeSessionStats | undefined): ConversationState {
  return { ...state, sessionStats };
}

export function setExtensionWidget(state: ConversationState, key: string, widget: ExtensionWidget | undefined): ConversationState {
  const extensionWidgets = { ...state.extensionWidgets };
  if (widget === undefined) delete extensionWidgets[key];
  else extensionWidgets[key] = widget;
  return { ...state, extensionWidgets };
}

/** Remove terminal formatting and control characters from extension-provided UI text. */
export function sanitizeExtensionUiText(value: string): string {
  return value
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/[\r\n]+/g, " ");
}

/** Converts persisted Pi messages into the same deduplicated representation as live RPC events. */
export function messagesToDisplay(messages: AgentMessage[]): DisplayMessage[] {
  let state = initialConversationState();
  for (const message of messages) {
    if (!isDisplayable(message)) continue;
    if (message.role === "toolResult") {
      state = applyToolResult(state, message);
    } else {
      state = addMessage(state, message, false);
    }
  }
  return state.messages;
}

export function reduceRpcEvent(state: ConversationState, event: JsonRecord): ConversationState {
  const next = reduceConversationEvent(state, event);
  const toolProgress = updateToolProgress(state, next, event);
  return toolProgress === next.toolProgress ? next : { ...next, toolProgress };
}

function reduceConversationEvent(state: ConversationState, event: JsonRecord): ConversationState {
  const type = string(event.type);
  if (type === "agent_start") return { ...state, busy: true, status: "Thinking…" };
  // Pi may retry, compact, or consume a queued prompt after agent_end. Only settled is idle.
  if (type === "agent_settled") return { ...state, busy: state.compacting === true, status: state.compacting ? "Compacting context…" : "Ready" };
  if (type === "process_error") return { ...state, busy: false, compacting: false, status: `Pi process error: ${string(event.error) || "unknown error"}` };
  if (type === "queue_update") {
    const steering = stringArray(event.steering);
    const followUp = stringArray(event.followUp);
    if (!steering || !followUp) return state;
    return { ...state, queue: { steering, followUp, authoritative: true, pendingCount: steering.length + followUp.length } };
  }

  if (type === "compaction_start") return { ...state, busy: true, compacting: true, status: "Compacting context…" };
  if (type === "compaction_end") {
    const manual = event.reason === "manual";
    const status = typeof event.errorMessage === "string" ? event.errorMessage
      : event.aborted === true ? "Compaction cancelled"
        : manual ? "Compaction complete" : event.willRetry === true ? "Retrying after compaction…" : "Working…";
    return { ...state, compacting: false, busy: !manual, status };
  }
  if (type === "auto_retry_start") {
    const attempt = number(event.attempt);
    const maxAttempts = number(event.maxAttempts);
    const delay = number(event.delayMs);
    const suffix = attempt === undefined ? "" : ` (${attempt}${maxAttempts === undefined ? "" : `/${maxAttempts}`})`;
    const wait = delay === undefined ? "" : ` in ${formatDelay(delay)}`;
    return { ...state, busy: true, status: `Retrying${suffix}${wait}…` };
  }
  if (type === "auto_retry_end") {
    return { ...state, busy: true, status: event.success === true ? "Working…" : `Retry failed${number(event.attempt) === undefined ? "" : ` (${number(event.attempt)})`}…` };
  }
  if (type === "summarization_retry_scheduled") {
    const attempt = number(event.attempt);
    const maxAttempts = number(event.maxAttempts);
    const delay = number(event.delayMs);
    return { ...state, busy: true, status: `Retrying compaction${attempt === undefined ? "" : ` (${attempt}${maxAttempts === undefined ? "" : `/${maxAttempts}`})`}${delay === undefined ? "" : ` in ${formatDelay(delay)}`}…` };
  }
  if (type === "summarization_retry_attempt_start") return { ...state, busy: true, status: "Retrying compaction…" };
  if (type === "summarization_retry_finished") return { ...state, busy: true, status: "Working…" };

  if (type === "message_start" && isAgentMessage(event.message) && isDisplayable(event.message)) {
    if (event.message.role === "toolResult") return applyToolResult(state, event.message);
    return addMessage(state, event.message, true);
  }

  if (type === "message_update") return applyMessageDelta(state, event.assistantMessageEvent);

  // turn_end is the protocol's authoritative aggregate for tool results. message_start/end
  // may also arrive for those results; both paths update the same toolCallId card idempotently.
  if (type === "turn_end" && Array.isArray(event.toolResults)) {
    return event.toolResults.reduce((next, result) => isAgentMessage(result) && result.role === "toolResult" ? applyToolResult(next, result) : next, state);
  }

  if (type === "message_end" && isAgentMessage(event.message) && isDisplayable(event.message)) {
    const message = event.message;
    if (message.role === "toolResult") return applyToolResult(state, message);
    return finishMessage(state, message);
  }

  if (type === "tool_execution_start") {
    const id = string(event.toolCallId);
    if (!id) return state;
    const name = string(event.toolName) || "tool";
    return applyToolUpdate({ ...state, busy: true, status: `Running ${name}…` }, {
      id,
      name,
      arguments: event.args,
      toolStatus: "running",
    });
  }

  if (type === "tool_execution_update" || type === "tool_execution_end") {
    const id = string(event.toolCallId);
    if (!id) return state;
    const name = string(event.toolName) || undefined;
    const executionOutput = toolOutput(type === "tool_execution_update" ? event.partialResult : event.result);
    return applyToolUpdate({ ...state, busy: true, status: type === "tool_execution_update" ? `Running ${name || "tool"}…` : "Working…" }, {
      id,
      name,
      executionOutput,
      ...(type === "tool_execution_update" && executionOutput.trim() ? { hasStreamingOutput: true } : {}),
      ...(type === "tool_execution_end" ? { isError: event.isError === true } : {}),
      toolStatus: type === "tool_execution_end" ? "finished" : "running",
    });
  }

  if (type === "extension_error") return { ...state, status: `Extension error: ${string(event.error) || "unknown error"}` };
  return state;
}

function addMessage(state: ConversationState, message: AgentMessage, streaming: boolean): ConversationState {
  const display = fromAgentMessage(message, keyFor(message), streaming);
  const messages = reconcileOrphanTools([...state.messages, display]);
  return { ...state, messages };
}

function finishMessage(state: ConversationState, message: AgentMessage): ConversationState {
  let index = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const candidate = state.messages[i];
    if (candidate.streaming && candidate.role === message.role && candidate.timestamp === message.timestamp && candidate.toolCallId === message.toolCallId) {
      index = i;
      break;
    }
  }
  if (index < 0) return addMessage(state, message, false);

  const messages = [...state.messages];
  const previous = messages[index];
  messages[index] = preserveToolCards(previous, fromAgentMessage(message, previous.key, false));
  return { ...state, messages: reconcileOrphanTools(messages) };
}

function applyToolResult(state: ConversationState, message: AgentMessage): ConversationState {
  const id = string(message.toolCallId);
  if (!id) return state;
  return applyToolUpdate(state, {
    id,
    name: message.toolName || undefined,
    resultOutput: toolOutput(message),
    isError: message.isError === true,
    toolStatus: "result",
  });
}

/** Attaches all tool lifecycle information to exactly one card, keyed by toolCallId. */
function applyToolUpdate(state: ConversationState, update: ToolUpdate): ConversationState {
  const messages = [...state.messages];
  let found = false;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (!Array.isArray(message.content)) continue;
    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== "toolCall" || block.id !== update.id) return block;
      found = true;
      changed = true;
      return mergeToolBlock(block, update);
    });
    if (changed) messages[messageIndex] = { ...message, content };
  }

  if (!found) {
    const existing = messages.findIndex((message) => message.role === "tool" && message.toolCallId === update.id);
    if (existing >= 0) {
      messages[existing] = mergeOrphanTool(messages[existing], update);
    } else {
      messages.push(mergeOrphanTool({
        key: `tool-${update.id}`, role: "tool", toolCallId: update.id,
      }, update));
    }
  }
  return { ...state, messages };
}

function mergeOrphanTool(message: DisplayMessage, update: ToolUpdate): DisplayMessage {
  const block = mergeToolBlock(toolMessageBlock(message), update);
  return {
    ...message,
    toolName: block.name,
    content: block.arguments === undefined ? undefined : safeJson(block.arguments),
    output: block.executionOutput,
    hasStreamingOutput: block.hasStreamingOutput,
    resultOutput: block.resultOutput,
    isError: block.isError,
    toolStatus: block.toolStatus,
    streaming: block.toolStatus === "running",
  };
}

/** Moves an out-of-order execution card into the assistant's ordered tool-call block. */
function reconcileOrphanTools(messages: DisplayMessage[]): DisplayMessage[] {
  const orphanById = new Map(messages.filter((message) => message.role === "tool" && message.toolCallId).map((message) => [message.toolCallId!, message]));
  if (!orphanById.size) return messages;
  const consumed = new Set<string>();
  const merged = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== "toolCall" || !block.id) return block;
      const orphan = orphanById.get(block.id);
      if (!orphan) return block;
      consumed.add(block.id);
      changed = true;
      const update = toolMessageBlock(orphan);
      return mergeToolBlock(block, {
        ...update, id: block.id,
        // Complete assistant inputs are authoritative; execution fills partial/missing ones.
        arguments: block.arguments && typeof block.arguments === "object" ? block.arguments : update.arguments,
      });
    });
    return changed ? { ...message, content } : message;
  });
  return consumed.size ? merged.filter((message) => message.role !== "tool" || !message.toolCallId || !consumed.has(message.toolCallId)) : merged;
}

function preserveToolCards(previous: DisplayMessage, next: DisplayMessage): DisplayMessage {
  if (!Array.isArray(previous.content) || !Array.isArray(next.content)) return next;
  const previousTools = new Map(previous.content.filter((block) => block.type === "toolCall" && block.id).map((block) => [block.id!, block]));
  return {
    ...next,
    content: next.content.map((block) => {
      if (block.type !== "toolCall" || !block.id) return block;
      const old = previousTools.get(block.id);
      return old ? mergeToolBlock(block, {
        id: block.id,
        executionOutput: old.executionOutput,
        hasStreamingOutput: old.hasStreamingOutput,
        resultOutput: old.resultOutput,
        isError: old.isError,
        toolStatus: old.toolStatus,
      }) : block;
    }),
  };
}

function applyMessageDelta(state: ConversationState, raw: unknown): ConversationState {
  if (!isRecord(raw)) return state;
  const assistantIndex = findStreamingAssistant(state.messages);
  if (assistantIndex < 0) return state;
  const kind = string(raw.type);
  const contentIndex = number(raw.contentIndex);
  if (contentIndex === undefined) return state;
  const messages = [...state.messages];
  const current = messages[assistantIndex];
  const content = Array.isArray(current.content) ? [...current.content] : [];
  const existing = content[contentIndex];

  if (kind === "text_start") content[contentIndex] = { type: "text", text: "" };
  else if (kind === "thinking_start") content[contentIndex] = { type: "thinking", thinking: "", thinkingComplete: false };
  else if (kind === "toolcall_start") {
    const id = string(raw.id);
    content[contentIndex] = existing?.type === "toolCall" && existing.id === id
      ? mergeToolBlock(existing, { id, name: string(raw.toolName) })
      : { type: "toolCall", id, name: string(raw.toolName), arguments: "" };
  }
  else if (kind === "text_delta") content[contentIndex] = { type: "text", text: `${existing?.text || ""}${string(raw.delta)}` };
  else if (kind === "thinking_delta") content[contentIndex] = { type: "thinking", thinking: `${existing?.thinking || ""}${string(raw.delta)}`, thinkingComplete: false };
  else if (kind === "text_end" && typeof raw.content === "string") content[contentIndex] = { type: "text", text: raw.content };
  else if (kind === "thinking_end" && typeof raw.content === "string") content[contentIndex] = { type: "thinking", thinking: raw.content, thinkingComplete: true };
  else if (kind === "toolcall_delta") {
    // Execution has already supplied complete inputs. A late generation fragment
    // must never replace those inputs with partial JSON or make its preview vanish.
    if (existing?.toolStatus !== undefined) return state;
    content[contentIndex] = { ...existing, type: "toolCall", arguments: `${typeof existing?.arguments === "string" ? existing.arguments : ""}${string(raw.delta)}` };
  }
  else if (kind === "toolcall_end" && isRecord(raw.toolCall)) {
    // Keep execution state that can arrive before the model's terminal tool-call event.
    // toolcall_end is authoritative for identity/arguments, not the execution lifecycle.
    const completed = toolCallBlock(raw.toolCall);
    content[contentIndex] = mergeToolBlock(existing || completed, {
      id: completed.id || "", name: completed.name, arguments: completed.arguments,
    });
  }
  else return state;

  messages[assistantIndex] = { ...current, content };
  return { ...state, messages: reconcileOrphanTools(messages) };
}

function fromAgentMessage(message: AgentMessage, key: string, streaming = false): DisplayMessage {
  return {
    key,
    role: message.role,
    content: message.content ?? (["compactionSummary", "branchSummary"].includes(message.role) && typeof message.summary === "string" ? message.summary : undefined),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    timestamp: message.timestamp,
    streaming,
    output: message.role === "bashExecution" ? string(message.output) : undefined,
  };
}

function toolCallBlock(value: JsonRecord): ContentBlock {
  return { type: "toolCall", id: string(value.id), name: string(value.name || value.toolName), arguments: value.arguments };
}

function keyFor(message: AgentMessage): string {
  return `${message.role}-${message.timestamp || Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findStreamingAssistant(messages: DisplayMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "assistant" && messages[index].streaming) return index;
  }
  return -1;
}

function toolOutput(result: unknown): string {
  if (isAgentMessage(result)) return contentText(result.content);
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return contentText(result.content as ContentBlock[]);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => isRecord(block) && typeof block.text === "string" ? block.text : "").join("");
}

function isDisplayable(message: AgentMessage): boolean {
  return ["user", "assistant", "toolResult", "bashExecution", "custom", "compactionSummary", "branchSummary"].includes(message.role);
}

function isAgentMessage(value: unknown): value is AgentMessage {
  return isRecord(value) && typeof value.role === "string";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return "[unserializable arguments]"; }
}

function formatDelay(delayMs: number): string {
  return `${Math.max(1, Math.round(delayMs / 1000))}s`;
}
