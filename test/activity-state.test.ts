import assert from "node:assert/strict";
import test from "node:test";
import { informationalExtensionStatuses, presentActivity, subagentCounts } from "../src/pi/activity-state";
import { sanitizeExtensionUiText } from "../src/pi/reducer";

test("settled main agent presents known active subagents in their own row without making generic statuses busy", () => {
  const presentation = presentActivity(false, "Ready", {
    subagents: "1 running, 2 queued agents",
    indexer: "syncing",
  });
  assert.deepEqual(presentation, {
    busy: false,
    text: "Idle — ready for your message",
    subagents: "1 running, 2 queued agents",
  });
  assert.deepEqual(informationalExtensionStatuses({ subagents: "1 running, 2 queued agents", indexer: "syncing" }), [["indexer", "syncing"]]);
});

test("clearing the subagents status returns the presentation to idle", () => {
  assert.deepEqual(presentActivity(false, "Ready", {}), {
    busy: false,
    text: "Idle — ready for your message",
  });
});

test("installed pi-subagents producer status strings, including ANSI-sanitized values, create a subagent row", () => {
  for (const [raw, expected] of [
    ["2 running agents", "2 running agents"],
    ["1 queued agent", "1 queued agent"],
    ["1 running, 2 queued agents", "1 running, 2 queued agents"],
    ["\u001b[35m2 running agents\u001b[0m", "2 running agents"],
  ]) {
    assert.equal(subagentCounts(sanitizeExtensionUiText(raw)), expected);
  }
});

test("only the documented subagents count status affects background busy presentation", () => {
  assert.equal(subagentCounts("running somewhere"), undefined);
  assert.equal(presentActivity(false, "Ready", { anotherExtension: "1 running, 2 queued agents" }).busy, false);
  const running = presentActivity(true, "Running tool…", { subagents: "1 running, 0 queued agents" });
  assert.equal(running.busy, true);
  assert.equal(running.text, "Running tool…");
  assert.equal(running.subagents, "1 running, 0 queued agents");
  assert.equal(running.text.includes("Pi:"), false);
});
