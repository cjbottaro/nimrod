import assert from "node:assert/strict";
import test from "node:test";
import { isEmptyAssistantMessage, transcriptRolePresentation } from "../src/pi/transcript-presentation";

test("only empty assistant text/reasoning envelopes are hidden", () => {
  const empty = (content?: import("../src/conversation-model").DisplayMessage["content"]) => isEmptyAssistantMessage({ key: "a", role: "assistant", content });
  assert.equal(empty(), true);
  assert.equal(empty(" \n"), true);
  assert.equal(empty([]), true);
  assert.equal(empty([{ type: "text", text: "  " }, { type: "thinking", thinking: "\n" }]), true);
  assert.equal(empty([{ type: "text", text: "Visible" }]), false);
  assert.equal(empty([{ type: "thinking", thinking: "Thought" }]), false);
  for (const type of ["toolCall", "image", "raw", "unknown"]) assert.equal(empty([{ type }]), false);
  for (const role of ["user", "tool", "configuration", "command"]) assert.equal(isEmptyAssistantMessage({ key: "a", role }), false);
  assert.equal(isEmptyAssistantMessage({ key: "a", role: "assistant", isError: true }), false);
});

test("user and assistant transcript roles are accessible without visible labels", () => {
  assert.deepEqual(transcriptRolePresentation("user", ""), { ariaLabel: "User message" });
  assert.deepEqual(transcriptRolePresentation("assistant", ""), { ariaLabel: "Assistant message" });
});

test("standalone tools use accessible labels rather than a redundant visible prefix", () => {
  assert.deepEqual(transcriptRolePresentation("tool", "read"), { ariaLabel: "Tool: read" });
});

test("legacy tool results and custom transcript labels remain visible", () => {
  assert.deepEqual(transcriptRolePresentation("toolResult", "read"), { visibleLabel: "Tool result: read" });
  assert.deepEqual(transcriptRolePresentation("custom", ""), { visibleLabel: "custom" });
});
