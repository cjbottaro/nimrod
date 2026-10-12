import assert from "node:assert/strict";
import test from "node:test";
import { applyQueuePendingCount, applyQueueUpdate, clearDraft, initialComposerState, recoverClearedQueue, restoreRecoveredQueueItem, updateDraft } from "../src/pi/composer-state";

test("sending clears the editable draft without recording a submission", () => {
  const state = clearDraft(initialComposerState("fix the test"));
  assert.equal(state.draft, "");
  assert.deepEqual(state.attachments, []);
  assert.deepEqual(state.recovered, []);
  assert.equal(Object.hasOwn(state, "submission"), false);
});

test("recovering more queue text after restoring one item does not reuse another item's ID", () => {
  let state = recoverClearedQueue(initialComposerState(), ["one", "two"], []);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  state = recoverClearedQueue(state, ["three"], []);
  assert.equal(new Set(state.recovered.map(item => item.id)).size, 2);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  assert.deepEqual(state.recovered.map(item => item.text), ["three"]);
});

test("a cleared composer is immediately available for the next draft", () => {
  const state = updateDraft(clearDraft(initialComposerState("first version")), "first version");
  assert.equal(state.draft, "first version");
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

test("clear_queue recovery preserves returned text and restores without overwriting a newer draft", () => {
  let state = initialComposerState("new draft");
  state = recoverClearedQueue(state, ["redirect"], ["summarize"]);
  assert.equal(state.recovered.length, 2);
  state = restoreRecoveredQueueItem(state, state.recovered[0].id);
  assert.equal(state.draft, "new draft\nredirect");
  assert.deepEqual(state.recovered.map((item) => item.text), ["summarize"]);
});
