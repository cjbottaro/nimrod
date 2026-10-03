import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { initialConversationState, reduceRpcEvent } from "../src/pi/reducer";
import { renderToolCard, updateToolCard } from "../src/pi/tool-card";
import { ContentBlock } from "../src/pi/types";

test("reconciling one out-of-order tool preserves other unmatched executions", () => {
  let state = initialConversationState();
  for (const id of ["a", "b"]) {
    state = reduceRpcEvent(state, { type: "tool_execution_start", toolCallId: id, toolName: "bash", args: { command: id } });
    state = reduceRpcEvent(state, { type: "tool_execution_update", toolCallId: id, toolName: "bash", partialResult: { content: [{ type: "text", text: `output ${id}` }] } });
  }
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [{ type: "toolCall", id: "a", name: "bash", arguments: { command: "a" } }] } });
  assert.equal(state.messages.filter(message => message.role === "tool").length, 1);
  assert.equal(state.messages.find(message => message.toolCallId === "b")?.output, "output b");
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "b", toolName: "bash" } });
  assert.equal(state.messages.filter(message => message.role === "tool").length, 0);
  const blocks = state.messages[0].content as ContentBlock[];
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].executionOutput, "output b");
  assert.deepEqual(blocks[1].arguments, { command: "b" });
});

test("late argument deltas cannot erase a running tool's complete inputs or preview", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } });
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "c", toolName: "bash" } });
  state = reduceRpcEvent(state, { type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: { command: "sleep 5; echo done" } });
  const dom = new JSDOM("<body></body>");
  const document = dom.window.document;
  const block = () => (state.messages[0].content as ContentBlock[])[0];
  const card = renderToolCard(document, block(), document.createElement("details"));
  document.body.append(card);
  const spinner = card.querySelector(".tool-card-spinner");
  state = reduceRpcEvent(state, { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: 'done"}' } });
  updateToolCard(document, card, block());
  assert.deepEqual(block().arguments, { command: "sleep 5; echo done" });
  assert.equal(card.querySelector(".tool-card-preview")?.textContent, "sleep 5; echo done");
  assert.equal(card.querySelector(".tool-card-spinner"), spinner);
  assert.equal(block().toolStatus, "running");
  dom.window.close();
});

test("authoritative final message arguments win while execution state survives", () => {
  let state = initialConversationState();
  state = reduceRpcEvent(state, { type: "message_start", message: { role: "assistant", timestamp: 1, content: [{ type: "toolCall", id: "c", name: "bash", arguments: '{"command":"pw' }] } });
  state = reduceRpcEvent(state, { type: "tool_execution_update", toolCallId: "c", toolName: "bash", partialResult: { content: [{ type: "text", text: "/work" }] } });
  state = reduceRpcEvent(state, { type: "message_end", message: { role: "assistant", timestamp: 1, content: [{ type: "toolCall", id: "c", name: "bash", arguments: { command: "pwd" } }] } });
  const block = (state.messages[0].content as ContentBlock[])[0];
  assert.deepEqual(block.arguments, { command: "pwd" });
  assert.equal(block.executionOutput, "/work");
  assert.equal(block.toolStatus, "running");
});
