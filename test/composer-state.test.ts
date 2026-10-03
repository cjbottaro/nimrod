import assert from "node:assert/strict";
import test from "node:test";
import { applyQueuePendingCount, applyQueueUpdate, beginSubmission, initialComposerState, recoverClearedQueue, restoreRecoveredQueueItem, settleSubmission, updateDraft } from "../src/pi/composer-state";

test("failed acknowledgement retains the submitted draft and settles the sender", () => {
  let state = initialComposerState("fix the test");
  state = beginSubmission(state, "one", "normal");
  state = settleSubmission(state, "one", "rejected", "Pi prompt failed: busy");
  assert.equal(state.draft, "fix the test");
  assert.equal(state.submission, undefined);
  assert.match(state.lastError || "", /Pi prompt failed/);
});

test("rejected sends retain both the original submission and a draft edited while waiting", () => {
  let state = beginSubmission(initialComposerState("original prompt"), "send1", "normal");
  state = updateDraft(state, "new draft");
  state = settleSubmission(state, "send1", "rejected", "unavailable");
  assert.equal(state.draft, "new draft");
  assert.deepEqual(state.recovered.map(item => [item.kind, item.text]), [["unsent", "original prompt"]]);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  assert.equal(state.draft, "new draft\noriginal prompt");
});

test("recovering more queue text after restoring one item does not reuse another item's ID", () => {
  let state = recoverClearedQueue(initialComposerState(), ["one", "two"], []);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  state = recoverClearedQueue(state, ["three"], []);
  assert.equal(new Set(state.recovered.map(item => item.id)).size, 2);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  assert.deepEqual(state.recovered.map(item => item.text), ["three"]);
});

test("successful acknowledgement never clears edits made while the submission is pending", () => {
  let state = initialComposerState("first version");
  state = beginSubmission(state, "one", "steer");
  state = updateDraft(state, "first version, edited");
  state = settleSubmission(state, "one", "accepted");
  assert.equal(state.draft, "first version, edited");
  assert.equal(state.submission, undefined);
});

test("queue_update replaces queue text authoritatively while get_state only supplies a fallback count", () => {
  let state = initialComposerState();
  state = applyQueuePendingCount(state, 3);
  assert.equal(state.queue.pendingCount, 3);
  assert.equal(state.queue.authoritative, false);
  state = applyQueueUpdate(state, ["steer now"], ["later"]);
  assert.deepEqual(state.queue, { steering: ["steer now"], followUp: ["later"], authoritative: true, pendingCount: 2 });
  state = applyQueuePendingCount(state, 99);
  assert.equal(state.queue.pendingCount, 2);
});

test("unknown acceptance remains unsettled rather than inviting an automatic resend", () => {
  let state = initialComposerState("do the thing");
  state = beginSubmission(state, "one", "followUp");
  state = settleSubmission(state, "one", "unknown", "Pi did not respond within 20 seconds");
  assert.equal(state.submission?.status, "unknown");
  assert.equal(beginSubmission(state, "two", "normal"), state);
});

test("clear_queue recovery preserves returned text and restores without overwriting a newer draft", () => {
  let state = initialComposerState("new draft");
  state = recoverClearedQueue(state, ["redirect"], ["summarize"]);
  assert.equal(state.recovered.length, 2);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  assert.equal(state.draft, "new draft\nredirect");
  assert.deepEqual(state.recovered.map((item) => item.text), ["summarize"]);
});
