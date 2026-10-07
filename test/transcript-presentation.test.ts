import assert from "node:assert/strict";
import test from "node:test";
import { transcriptRolePresentation } from "../src/pi/transcript-presentation";

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
