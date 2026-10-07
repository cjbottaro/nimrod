import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { initialConversationState, reduceRpcEvent } from "../src/pi/reducer";
import { projectToolTimeline, renderParallelToolCard } from "../src/pi/tool-progress";
import { renderToolCard, updateToolCard } from "../src/pi/tool-card";
import type { ContentBlock, JsonRecord } from "../src/pi/types";

function scenario() {
  let state = reduceRpcEvent(initialConversationState(), { type: "agent_start" });
  return {
    get state() { return state; },
    event(event: JsonRecord) { state = reduceRpcEvent(state, event); },
    start(id: string) { state = reduceRpcEvent(state, { type: "tool_execution_start", toolCallId: id, toolName: "read", args: { path: `${id}.ts` } }); },
    end(id: string, isError = false) { state = reduceRpcEvent(state, { type: "tool_execution_end", toolCallId: id, toolName: "read", isError, result: { content: [{ type: "text", text: `result ${id}` }] } }); },
  };
}

test("single tool execution finishes independently of its processing-result presentation", () => {
  const run = scenario(); run.start("a"); run.end("a");
  assert.equal(run.state.messages[0].toolStatus, "finished");
  assert.equal(run.state.toolProgress?.processingToolId, "a");
  assert.equal(projectToolTimeline(run.state.messages, run.state.toolProgress)[0].uiPhase, "thinking");
  run.event({ type: "agent_end" });
  assert.equal(run.state.toolProgress?.processingToolId, "a");
  run.event({ type: "agent_settled" });
  assert.equal(run.state.toolProgress?.processingToolId, undefined);
});

test("single-tool thinking stops at new visible output or the next execution", () => {
  const run = scenario(); run.start("a"); run.end("a");
  run.event({ type: "message_start", message: { role: "assistant", timestamp: 1, content: [] } });
  assert.equal(run.state.toolProgress?.processingToolId, "a");
  run.event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Next answer" } });
  assert.equal(run.state.toolProgress?.processingToolId, undefined);
  run.start("b"); run.end("b");
  assert.equal(run.state.toolProgress?.processingToolId, "b");
  run.start("c");
  assert.equal(run.state.toolProgress?.processingToolId, undefined);
});

test("overlapping calls add a live bottom card and keep active work sorted last", () => {
  const run = scenario(); run.start("a"); run.start("b");
  assert.deepEqual(run.state.toolProgress?.active.map(tool => tool.id), ["a", "b"]);
  assert.deepEqual(projectToolTimeline(run.state.messages, run.state.toolProgress).map(row => row.key), ["tool:a", "tool:b", "parallel:b"]);
  run.end("a");
  assert.equal(run.state.toolProgress?.processingToolId, undefined);
  const dom = new JSDOM("<body></body>"); const document = dom.window.document;
  const overview = renderParallelToolCard(document, run.state.toolProgress!.parallel!); document.body.append(overview);
  assert.equal(overview.open, true);
  assert.deepEqual([...overview.querySelectorAll<HTMLElement>(".parallel-tool-row")].map(row => row.dataset.toolId), ["a", "b"]);
  assert.ok(overview.querySelector('[data-tool-id="a"] .tool-card-succeeded'));
  assert.ok(overview.querySelector('[data-tool-id="b"] .tool-card-spinner'));
  run.end("b");
  assert.equal(run.state.toolProgress?.processingToolId, "b");
  assert.equal(run.state.toolProgress?.parallel, undefined);
  assert.deepEqual(projectToolTimeline(run.state.messages, run.state.toolProgress).map(row => row.key), ["tool:a", "tool:b"]);
  dom.window.close();
});

test("parallel-card updates repair an interrupted partial shell", () => {
  const dom = new JSDOM("<body></body>"); const document = dom.window.document;
  const cluster = { id: "parallel:b", tools: [
    { id: "a", name: "read", status: "done" as const },
    { id: "b", name: "bash", status: "running" as const },
  ] };
  const overview = renderParallelToolCard(document, cluster); document.body.append(overview);
  overview.querySelector(".parallel-indicator")!.remove();

  assert.doesNotThrow(() => renderParallelToolCard(document, cluster, overview));
  assert.ok(overview.querySelector(".parallel-indicator.tool-card-spinner"));
  assert.deepEqual([...overview.querySelectorAll<HTMLElement>(".parallel-tool-row")].map(row => row.dataset.toolId), ["a", "b"]);
  dom.window.close();
});

test("tool failures are immediate and disconnect or settlement stops every unfinished card", () => {
  const failed = scenario(); failed.start("a"); failed.end("a", true);
  assert.equal(failed.state.toolProgress?.processingToolId, undefined);
  for (const type of ["process_error", "agent_settled"]) {
    const run = scenario(); run.start("a"); run.start("b"); run.end("a");
    run.event({ type, error: "disconnected" });
    assert.deepEqual(run.state.toolProgress?.active, []);
    const rows = projectToolTimeline(run.state.messages, run.state.toolProgress);
    assert.equal(rows.find(row => row.key === "tool:b")?.uiPhase, "stopped");
  }
});

test("single-tool thinking keeps the spinner and accessible status without a tooltip or expanded status line", () => {
  const dom = new JSDOM("<body></body>"); const document = dom.window.document;
  const block: ContentBlock = { type: "toolCall", id: "a", name: "read", arguments: { path: "a.ts" }, toolStatus: "running" };
  const card = renderToolCard(document, block, document.createElement("details")); document.body.append(card);
  const spinner = card.querySelector(".tool-card-spinner");
  updateToolCard(document, card, { ...block, toolStatus: "finished", executionOutput: "output", uiPhase: "thinking" });
  assert.equal(card.querySelector(".tool-card-spinner"), spinner);
  assert.match(card.querySelector("summary")!.getAttribute("aria-label") || "", /thinking/i);
  assert.equal(card.querySelector("[title]"), null);
  assert.equal(card.querySelector(".tool-phase"), null);
  updateToolCard(document, card, { ...block, toolStatus: "finished", executionOutput: "output" });
  assert.ok(card.querySelector(".tool-card-succeeded"));
  assert.equal(card.querySelector(".tool-phase"), null);
  dom.window.close();
});
