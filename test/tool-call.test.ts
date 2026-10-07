import assert from "node:assert/strict";
import test from "node:test";
import { initialConversationState, messagesToDisplay, reduceRpcEvent } from "../src/pi/reducer";
import { mergeToolCall, toolMessageBlock } from "../src/pi/tool-call";
import type { ContentBlock } from "../src/pi/types";

test("the common tool model accepts partial updates without rewinding a terminal result", () => {
  let card: ContentBlock = { type: "toolCall", id: "c" };
  card = mergeToolCall(card, { id: "c", name: "read", resultOutput: "failed", isError: true, toolStatus: "result" });
  card = mergeToolCall(card, { id: "c", arguments: { path: "file" }, toolStatus: "running" });
  card = mergeToolCall(card, { id: "c", executionOutput: "old", isError: false, toolStatus: "finished" });
  assert.equal(card.toolStatus, "result");
  assert.equal(card.isError, true);
  assert.equal(card.resultOutput, "failed");
  assert.deepEqual(card.arguments, { path: "file" });
});

test("assistant-first and execution-first streams converge on the same single card", () => {
  const assistant = { type: "message_start", message: { role: "assistant", timestamp: 1, content: [{ type: "toolCall", id: "c", name: "read", arguments: { path: "file" } }] } };
  const execution = { type: "tool_execution_start", toolCallId: "c", toolName: "read", args: { path: "file" } };
  const finalCards = [];
  for (const events of [[assistant, execution], [execution, assistant]]) {
    let state = initialConversationState();
    for (const event of [
      ...events,
      { type: "tool_execution_update", toolCallId: "c", partialResult: { content: [{ type: "text", text: "live" }] } },
      { type: "message_end", message: { role: "toolResult", toolCallId: "c", toolName: "read", content: [{ type: "text", text: "final" }] } },
      execution,
      { type: "tool_execution_end", toolCallId: "c", result: { content: [{ type: "text", text: "stale" }] } },
    ]) state = reduceRpcEvent(state, event);
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, "assistant");
    finalCards.push((state.messages[0].content as ContentBlock[])[0]);
  }
  assert.deepEqual(finalCards[0], finalCards[1]);
  assert.equal(finalCards[0].toolStatus, "result");
  assert.equal(finalCards[0].executionOutput, "live");
});

test("results-first history reconciles and missing assistant content remains a normal card", () => {
  const result = { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "done" }] };
  const standalone = messagesToDisplay([result, result]);
  assert.equal(standalone.length, 1);
  assert.equal(toolMessageBlock(standalone[0]).resultOutput, "done");
  const reconciled = messagesToDisplay([result, {
    role: "assistant", content: [{ type: "toolCall", id: "c", name: "read", arguments: { path: "file" } }],
  }]);
  assert.equal(reconciled.length, 1);
  const card = (reconciled[0].content as ContentBlock[])[0];
  assert.equal(card.name, "read");
  assert.deepEqual(card.arguments, { path: "file" });
  assert.equal(card.resultOutput, "done");
});

test("complete assistant arguments win over earlier execution inputs", () => {
  let state = reduceRpcEvent(initialConversationState(), { type: "tool_execution_start", toolCallId: "c", toolName: "read", args: { path: "old" } });
  state = reduceRpcEvent(state, { type: "message_end", message: {
    role: "assistant", content: [{ type: "toolCall", id: "c", name: "read", arguments: { path: "final" } }],
  } });
  assert.deepEqual((state.messages[0].content as ContentBlock[])[0].arguments, { path: "final" });
});
