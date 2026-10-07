import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { captureStreamingOutput, createToolDetails, renderToolCard, restoreStreamingOutput, setToolDetailsAutoOpen, updateToolCard } from "../src/pi/tool-card";

function document(): Document {
  return new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true }).window.document;
}

function card(doc: Document, block: Parameters<typeof renderToolCard>[1], open = false): HTMLDetailsElement {
  return renderToolCard(doc, { toolStatus: "result", ...block }, createToolDetails(doc, new Map(), "tool", open));
}

test("incomplete tool arguments show a preparation spinner without placeholder previews", () => {
  const doc = document();
  for (const name of ["bash", "read", "Agent", "steer_subagent"]) {
    for (const args of [undefined, "", "{\"command\":", {}]) {
      const tool = card(doc, { name, arguments: args, toolStatus: undefined });
      assert.ok(tool.querySelector(".tool-card-spinner"));
      assert.equal(tool.querySelector(".tool-card-preview"), null);
      assert.equal(tool.querySelector(".tool-card-dot"), null);
    }
  }
  const ready = card(doc, { name: "bash", arguments: { command: "pwd" }, toolStatus: "running" });
  assert.equal(ready.querySelector(".tool-card-preview")?.textContent, "pwd");
});

test("streaming arguments expose only complete top-level preview fields", () => {
  const doc = document();
  const description = card(doc, {
    name: "Agent",
    toolStatus: undefined,
    arguments: '{"description":"Inspect the reducer","prompt":"still streaming',
  });
  assert.equal(description.querySelector(".tool-card-preview")?.textContent, "Inspect the reducer");

  const command = card(doc, {
    name: "bash",
    toolStatus: undefined,
    arguments: '{"command":"pwd","timeout":',
  });
  assert.equal(command.querySelector(".tool-card-preview")?.textContent, "pwd");

  const escaped = card(doc, {
    name: "Agent",
    toolStatus: undefined,
    arguments: '{"description":"Quote: \\" and snowman: \\u2603","prompt":',
  });
  assert.equal(escaped.querySelector(".tool-card-preview")?.textContent, "Quote: \" and snowman: ☃");

  const nested = card(doc, {
    name: "Agent",
    toolStatus: undefined,
    arguments: '{"prompt":{"description":"nested only"},"subagent_type":"Explore",',
  });
  assert.equal(nested.querySelector(".tool-card-preview"), null);

  for (const argumentsValue of ['{"description":"unterminated', '{"description":\\q', '{bad']) {
    assert.doesNotThrow(() => updateToolCard(doc, description, { name: "Agent", toolStatus: "running", arguments: argumentsValue }));
  }
});

test("tool header previews are plain inputs and expanded cards contain raw inputs only", () => {
  const doc = document();
  const edit = card(doc, {
    name: "edit",
    arguments: { file_path: "src/webview-client.ts", edits: [{ oldText: "a".repeat(2_000), newText: "b".repeat(2_000) }] },
  });
  const bash = card(doc, { name: "bash", arguments: { command: "git status --short" } });
  const search = card(doc, { name: "grep", arguments: { query: "tool-output", path: "src" } });
  const custom = card(doc, { name: "vendor_action", arguments: { payload: "<img src=x onerror=alert(1)>", options: { dryRun: true } } });

  assert.equal(edit.querySelector(".tool-card-preview")?.textContent, "src/webview-client.ts");
  assert.equal(bash.querySelector(".tool-card-preview")?.textContent, "git status --short");
  assert.equal(search.querySelector(".tool-card-preview")?.textContent, "tool-output in src");
  assert.equal(custom.querySelector(".tool-card-preview")?.textContent, "2 fields");
  assert.equal(edit.querySelector(".tool-input-summary"), null);
  assert.equal(bash.querySelector(".tool-input-summary"), null);
  assert.equal(search.querySelector(".tool-input-summary"), null);
  assert.equal(custom.querySelector("img"), null);

  const raw = edit.querySelector<HTMLDetailsElement>(".tool-raw-inputs");
  assert.ok(raw);
  assert.equal(raw.open, false);
  assert.match(raw.querySelector("pre")?.textContent || "", /"edits"/);
});

test("web tools show both singular and plural search targets in their previews", () => {
  const doc = document();
  const webSearch = card(doc, { name: "web_search", arguments: { query: "Pi RPC", queries: ["Pi compaction", "Pi extensions"] } });
  const fetch = card(doc, { name: "fetch_content", arguments: { url: "https://example.com/one", urls: ["https://example.com/two", "https://example.com/three"] } });
  assert.equal(webSearch.querySelector(".tool-card-preview")?.textContent, "Pi RPC · Pi compaction · Pi extensions");
  assert.equal(fetch.querySelector(".tool-card-preview")?.textContent, "https://example.com/one · https://example.com/two · https://example.com/three");
  const partial = card(doc, { name: "web_search", arguments: '{"query":"Pi RPC","queries":' });
  assert.equal(partial.querySelector(".tool-card-preview")?.textContent, "Pi RPC");
  assert.equal(card(doc, { name: "fetch_content", arguments: { urls: ["https://example.com/only"] } }).querySelector(".tool-card-preview")?.textContent, "https://example.com/only");
});

test("Agent previews use description for normalized agent names without catching unrelated tools", () => {
  const doc = document();
  for (const name of ["Agent", "agent", "subagent", "functions.Agent"]) {
    const tool = card(doc, { name, arguments: { description: "Investigate the reducer", prompt: "long full prompt", subagent_type: "Explore" } });
    const preview = tool.querySelector<HTMLElement>(".tool-card-preview");
    assert.equal(preview?.textContent, "Investigate the reducer", name);
    assert.equal(preview?.hasAttribute("title"), false, name);
  }

  const missingDescription = card(doc, { name: "agent", arguments: { prompt: "long full prompt" } });
  assert.equal(missingDescription.querySelector(".tool-card-preview")?.textContent, "No description provided");

  const unrelated = card(doc, { name: "agent_status", arguments: { description: "not an agent invocation", task: "status" } });
  assert.equal(unrelated.querySelector(".tool-card-preview")?.textContent, "2 fields");
});

test("steer_subagent previews its raw message field for normalized names", () => {
  const doc = document();
  const message = "Prioritize the failing activity indicator test.";
  for (const name of ["steer_subagent", "functions.steer_subagent"]) {
    const tool = card(doc, { name, arguments: { agentId: "agent-1", message } });
    assert.equal(tool.querySelector(".tool-card-preview")?.textContent, message, name);
    assert.equal(tool.querySelector(".tool-card-preview")?.hasAttribute("title"), false, name);
    assert.match(tool.querySelector(".tool-raw-inputs pre")?.textContent || "", /"message"/);
  }
});

test("tool summary keeps its name and running spinner while a long preview is truncatable", () => {
  const doc = document();
  const command = "echo ".concat("x".repeat(2_000));
  const tool = card(doc, { name: "bash", toolStatus: "running", arguments: { command } });
  const summary = tool.querySelector("summary");
  const preview = tool.querySelector<HTMLElement>(".tool-card-preview");

  assert.equal(summary?.querySelector(".tool-card-title")?.textContent, "bash");
  assert.equal(summary?.getAttribute("aria-label"), "bash (running)");
  assert.ok(summary?.querySelector(".tool-card-spinner"));
  assert.equal(summary?.querySelector(".tool-card-summary")?.firstElementChild?.className, "tool-card-spinner");
  assert.equal(preview?.textContent, command);
  assert.equal(preview?.hasAttribute("title"), false);
  assert.equal(tool.querySelector<HTMLDetailsElement>(".tool-raw-inputs")?.open, false);
});

test("tool cards have no hover tooltips on initial render or lifecycle updates", () => {
  const doc = document();
  const tool = card(doc, { name: "bash", toolStatus: undefined, arguments: '{"command":"pwd",' });
  assert.equal(tool.querySelector("[title]"), null);
  for (const block of [
    { toolStatus: "running" as const },
    { toolStatus: "finished" as const, uiPhase: "thinking" as const },
    { toolStatus: "running" as const, uiPhase: "stopped" as const },
    { toolStatus: "result" as const },
    { toolStatus: "result" as const, isError: true },
  ]) {
    updateToolCard(doc, tool, { name: "bash", arguments: { command: "echo updated" }, ...block });
    assert.equal(tool.querySelector("[title]"), null);
    assert.match(tool.querySelector("summary")?.getAttribute("aria-label") || "", /^bash \(/);
  }
});

test("streaming updates retain the connected spinner rather than replacing or reparenting it", () => {
  const doc = document();
  const tool = card(doc, { name: "bash", toolStatus: "running", executionOutput: "one" }, true);
  doc.body.append(tool);
  const spinner = tool.querySelector<HTMLElement>(".tool-card-spinner");
  assert.ok(spinner);
  const parent = spinner.parentElement;
  const observer = new doc.defaultView!.MutationObserver(() => undefined);
  observer.observe(doc.body, { childList: true, subtree: true });

  updateToolCard(doc, tool, { name: "bash", toolStatus: "running", executionOutput: "one\ntwo" });

  assert.equal(tool.querySelector(".tool-card-spinner"), spinner);
  assert.equal(spinner.parentElement, parent);
  assert.equal(spinner.isConnected, true);
  const records = observer.takeRecords();
  assert.equal(records.some((record) => Array.from(record.addedNodes).includes(spinner) || Array.from(record.removedNodes).includes(spinner)), false);
  assert.equal(tool.querySelector(".tool-output-streaming")?.textContent, "one\ntwo");

  updateToolCard(doc, tool, { name: "bash", toolStatus: "result", resultOutput: "done" });
  assert.equal(tool.querySelector(".tool-card-spinner"), null);
  assert.ok(tool.querySelector(".tool-card-succeeded"));
  updateToolCard(doc, tool, { name: "bash", toolStatus: "result", resultOutput: "failed", isError: true });
  assert.ok(tool.querySelector(".tool-card-failed"));
});

test("successful tool cards omit terminal statuses while failures remain explicit", () => {
  const doc = document();
  for (const toolStatus of ["finished", "result"] as const) {
    const summary = card(doc, { name: "read", toolStatus }).querySelector("summary");
    assert.equal(summary?.textContent, "read");
    assert.equal(summary?.getAttribute("aria-label"), "read (succeeded)");
    assert.ok(summary?.querySelector(".tool-card-succeeded"));
    assert.equal(summary?.querySelector(".tool-card-spinner"), null);
  }
  const failure = card(doc, { name: "read", toolStatus: "result", isError: true }).querySelector("summary");
  assert.equal(failure?.textContent, "read");
  assert.equal(failure?.getAttribute("aria-label"), "read (failed)");
  assert.ok(failure?.querySelector(".tool-card-failed"));
  const pending = card(doc, { name: "read", toolStatus: undefined });
  assert.ok(pending.querySelector(".tool-card-spinner"));
  assert.equal(pending.querySelector(".tool-card-succeeded"), null);
});

test("foreground Agent partial results use the normal capped live-output viewport", () => {
  const doc = document();
  const agent = card(doc, {
    name: "Agent",
    toolStatus: "running",
    arguments: { description: "Inspect reducer", prompt: "full prompt is raw input only" },
    executionOutput: "progress\n".repeat(20),
  }, true);

  assert.equal(agent.querySelector(".tool-card-preview")?.textContent, "Inspect reducer");
  const output = agent.querySelector<HTMLElement>(".tool-output-streaming");
  assert.ok(output);
  assert.equal(output.getAttribute("aria-label"), "Live output");
  assert.equal(output.textContent, "progress\n".repeat(20));
});

test("streaming output has a dedicated capped viewport and retains inspection position", () => {
  const doc = document();
  const previous = card(doc, { name: "bash", toolStatus: "running", executionOutput: "line\n".repeat(20) }, true);
  const oldOutput = previous.querySelector<HTMLElement>(".tool-output-streaming");
  assert.ok(oldOutput);
  assert.equal(oldOutput.tabIndex, 0);
  Object.defineProperties(oldOutput, { clientHeight: { value: 100 }, scrollHeight: { value: 400 } });
  oldOutput.scrollTop = 120;
  const position = captureStreamingOutput(previous);
  assert.deepEqual(position, { top: 120, atBottom: false });

  const updated = card(doc, { name: "bash", toolStatus: "running", executionOutput: "line\n".repeat(30) }, true);
  const newOutput = updated.querySelector<HTMLElement>(".tool-output-streaming");
  assert.ok(newOutput);
  Object.defineProperties(newOutput, { clientHeight: { value: 100 }, scrollHeight: { value: 600 } });
  restoreStreamingOutput(updated, position);
  assert.equal(newOutput.scrollTop, 120);

  oldOutput.scrollTop = 300;
  restoreStreamingOutput(updated, captureStreamingOutput(previous));
  assert.equal(newOutput.scrollTop, 600);
  assert.ok(updated.querySelector(".tool-output-final") === null);
});

test("automatic completion close does not become a user disclosure preference", async () => {
  const doc = document();
  const expanded = new Map<string, boolean>();
  const running = createToolDetails(doc, expanded, "call-1", true);
  doc.body.append(running);
  setToolDetailsAutoOpen(running, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(running.open, false);
  assert.equal(expanded.has("call-1"), false);

  running.open = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(expanded.get("call-1"), true);
});

test("tool cards auto-open only while running and preserve explicit user state", async () => {
  const doc = document();
  const expanded = new Map<string, boolean>();
  const running = createToolDetails(doc, expanded, "call-1", true);
  doc.body.append(running);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(expanded.has("call-1"), false);

  running.open = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(expanded.get("call-1"), false);
  assert.equal(createToolDetails(doc, expanded, "call-1", false).open, false);

  const finished = createToolDetails(doc, expanded, "call-1", false);
  doc.body.append(finished);
  finished.open = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(expanded.get("call-1"), true);
  assert.equal(createToolDetails(doc, expanded, "call-1", false).open, true);
});
