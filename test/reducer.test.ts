import assert from "node:assert/strict";
import test from "node:test";
import { initialConversationState, messagesToDisplay, reduceRpcEvent, sanitizeExtensionUiText, setExtensionStatus, setSessionStats } from "../src/pi/reducer";

test("live system messages are hidden just like history, including standalone message_end events", () => {
  const system = { role: "system", content: "", sections: { cwd: "/workspace" }, timestamp: 1 };
  const user = { role: "user", content: "Hello", timestamp: 2 };
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "agent_start" });
  state = reduceRpcEvent(state, { type: "message_start", message: system });
  assert.deepEqual(state.messages, []);
  state = reduceRpcEvent(state, { type: "message_end", message: system });
  state = reduceRpcEvent(state, { type: "message_end", message: { ...system, content: "Updated system instructions", timestamp: 3 } });
  assert.deepEqual(state.messages, []);
  assert.equal(state.busy, true);
  state = reduceRpcEvent(state, { type: "message_start", message: user });
  state = reduceRpcEvent(state, { type: "message_end", message: user });
  assert.deepEqual(state.messages.map(message => message.content), ["Hello"]);
  assert.deepEqual(messagesToDisplay([system, user]).map(message => message.content), ["Hello"]);
});

test("session stats replace only the native metrics without changing activity state", () => {
  const state = { ...initialConversationState(), busy: true, status: "Working…" };
  const withStats = setSessionStats(state, { cost: 0, context: { tokens: null, contextWindow: 1_100_000, percent: null }, autoCompactionEnabled: true });
  assert.equal(withStats.busy, true);
  assert.equal(withStats.status, "Working…");
  assert.equal(withStats.sessionStats?.cost, 0);
  assert.equal(withStats.sessionStats?.context?.percent, null);
  assert.equal(setSessionStats(withStats, undefined).sessionStats, undefined);
});

test("live deltas are assembled by contentIndex and message_end is authoritative", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "agent_start" });
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", content: [] } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "plan" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hel" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "lo" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, id: "call-1", toolName: "bash" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: "{\\\"command\\\":\\\"pwd" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: { id: "call-1", name: "bash", arguments: { command: "pwd" } } } });
  assert.deepEqual(state.messages[0].content, [{ type: "thinking", thinking: "plan", thinkingComplete: false }, { type: "text", text: "Hello" }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }]);
  state = reduceRpcEvent(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello, final." }] } });
  assert.deepEqual(state.messages[0].content, [{ type: "text", text: "Hello, final." }]);
  assert.equal(state.messages[0].streaming, false);
});

test("thinking_end completes streaming reasoning and persisted reasoning remains displayable", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "partial" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "completed streamed reasoning" } });
  assert.deepEqual(state.messages[0].content, [{ type: "thinking", thinking: "completed streamed reasoning", thinkingComplete: true }]);

  state = reduceRpcEvent(state, { type: "message_end", message: { role: "assistant", timestamp: 1, content: [{ type: "thinking", thinking: "persisted final reasoning" }] } });
  assert.deepEqual(state.messages[0].content, [{ type: "thinking", thinking: "persisted final reasoning" }]);

  const history = messagesToDisplay([{ role: "assistant", timestamp: 2, content: [{ type: "thinking", thinking: "persisted history reasoning" }] }]);
  assert.deepEqual(history[0].content, [{ type: "thinking", thinking: "persisted history reasoning" }]);
});

test("user start/end updates one row and preserves genuinely repeated prompts", () => {
  let state = initialConversationState();
  for (const timestamp of [1, 2]) {
    const message = { role: "user", timestamp, content: "Hello" };
    state = reduceRpcEvent(state, { type: "message_start", message });
    const key = state.messages[state.messages.length - 1].key;
    state = reduceRpcEvent(state, { type: "message_end", message });
    assert.equal(state.messages.length, timestamp);
    assert.equal(state.messages[timestamp - 1].key, key);
    assert.equal(state.messages[timestamp - 1].streaming, false);
  }
});

test("unmatched tool results cannot replace a streaming assistant", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } });
  const message = { role: "toolResult", timestamp: 2, toolCallId: "call-1", content: [{ type: "text", text: "done" }] };
  state = reduceRpcEvent(state, { type: "message_start", message });
  state = reduceRpcEvent(state, { type: "message_end", message });
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].role, "assistant");
  assert.equal(state.messages[0].streaming, true);
  assert.equal(state.messages[1].role, "tool");
  assert.equal(state.messages[1].toolCallId, "call-1");
  assert.equal(state.messages[1].resultOutput, "done");
});

test("unmatched message end remains visible", () => {
  const state = reduceRpcEvent(initialConversationState(), {
    type: "message_end", message: { role: "user", content: "Hello" },
  });
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].content, "Hello");
});

test("manual compaction unlocks at completion without requiring an agent_settled event", () => {
  let state = reduceRpcEvent(initialConversationState(), { type: "compaction_start", reason: "manual" });
  assert.equal(state.compacting, true);
  state = reduceRpcEvent(state, { type: "agent_settled" });
  assert.equal(state.busy, true);
  state = reduceRpcEvent(state, { type: "compaction_end", reason: "manual", result: { summary: "summary" }, aborted: false });
  assert.equal(state.compacting, false);
  assert.equal(state.busy, false);
  assert.equal(state.status, "Compaction complete");
  const history = messagesToDisplay([{ role: "compactionSummary", summary: "Kept the important decisions", timestamp: 1 }]);
  assert.equal(history[0].content, "Kept the important decisions");
});

test("agent_settled, not agent_end, changes busy state to idle", () => {
  let state = { ...initialConversationState(), busy: true, status: "Working…" };
  state = reduceRpcEvent(state, { type: "agent_end", willRetry: false });
  assert.equal(state.busy, true);
  state = reduceRpcEvent(state, { type: "agent_settled" });
  assert.equal(state.busy, false);
  assert.equal(state.status, "Ready");
});

test("extension statuses persist after agent_settled until their extension clears them", () => {
  let state = { ...initialConversationState(), busy: true, status: "Working…" };
  state = setExtensionStatus(state, "subagents", sanitizeExtensionUiText("\u001b[35m2 running agents\u001b[0m"));
  state = reduceRpcEvent(state, { type: "agent_settled" });
  assert.equal(state.busy, false);
  assert.equal(state.status, "Ready");
  assert.deepEqual(state.extensionStatuses, { subagents: "2 running agents" });

  state = setExtensionStatus(state, "subagents", undefined);
  assert.deepEqual(state.extensionStatuses, {});
});

test("tool lifecycle is one ordered assistant card with args, accumulated output, and authoritative result", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c1", toolName: "bash" } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: { id: "c1", name: "bash", arguments: { command: "pwd" } } } });
  state = reduceRpcEvent(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "pwd" } });
  state = reduceRpcEvent(state, { type: "tool_execution_update", toolCallId: "c1", partialResult: { content: [{ type: "text", text: "/workspace\n" }] } });
  state = reduceRpcEvent(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "/workspace\n" }] } });
  state = reduceRpcEvent(state, { type: "message_end", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "/workspace/final\n" }] } });
  state = reduceRpcEvent(state, { type: "turn_end", toolResults: [{ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "/workspace/final\n" }] }] });
  assert.equal(state.messages.length, 1);
  const tool = (state.messages[0].content as Array<{ arguments?: unknown; executionOutput?: string; hasStreamingOutput?: boolean; resultOutput?: string; toolStatus?: string }>)[0];
  assert.deepEqual(tool.arguments, { command: "pwd" });
  assert.equal(tool.executionOutput, "/workspace\n");
  assert.equal(tool.hasStreamingOutput, true);
  assert.equal(tool.resultOutput, "/workspace/final\n");
  assert.equal(tool.toolStatus, "result");
});

test("history merges tool results into their call without a duplicate row", () => {
  const messages = messagesToDisplay([
    { role: "assistant", timestamp: 1, content: [{ type: "text", text: "Checking" }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } }] },
    { role: "toolResult", timestamp: 2, toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "done" }] },
  ]);
  assert.equal(messages.length, 1);
  const content = messages[0].content as Array<{ resultOutput?: string }>;
  assert.equal(content.length, 2);
  assert.equal(content[1].resultOutput, "done");
});

test("working status remains specific through tool, retry, and compaction lifecycles", () => {
  let state = reduceRpcEvent(initialConversationState(), { type: "agent_start" });
  assert.equal(state.status, "Thinking…");
  state = reduceRpcEvent(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
  assert.equal(state.status, "Running read…");
  state = reduceRpcEvent(state, { type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 2000 });
  assert.equal(state.status, "Retrying (2/3) in 2s…");
  state = reduceRpcEvent(state, { type: "compaction_start" });
  assert.equal(state.status, "Compacting context…");
  state = reduceRpcEvent(state, { type: "process_error", error: "Pi exited" });
  assert.equal(state.busy, false);
  assert.equal(state.status, "Pi process error: Pi exited");
});
