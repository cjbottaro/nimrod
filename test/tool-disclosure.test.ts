import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createToolDetails } from "../src/pi/tool-card";
import { ToolDisclosureController } from "../src/pi/tool-disclosure";

const tick = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function fixture() {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const expanded = new Map<string, boolean>();
  const disclosure = new ToolDisclosureController(expanded, 15);
  const details = createToolDetails(dom.window.document, expanded, "call-1", false, key => disclosure.manualToggle(key));
  dom.window.document.body.append(details);
  return { dom, expanded, disclosure, details };
}

test("tool disclosure stays closed for generation, silent work, and output shorter than the debounce", async () => {
  const { dom, disclosure, details } = fixture();
  try {
    disclosure.update(details, true, true, false);
    assert.equal(details.open, false);
    disclosure.update(details, true, true, true);
    await tick(5);
    disclosure.update(details, false, false, true);
    await tick(20);
    assert.equal(details.open, false);
  } finally { disclosure.dispose(); dom.window.close(); }
});

test("final results and model-thinking never qualify a closed card for automatic opening", async () => {
  const { dom, disclosure, details } = fixture();
  try {
    disclosure.update(details, true, false, false);
    await tick(20);
    assert.equal(details.open, false);
    disclosure.update(details, true, false, true);
    await tick(20);
    assert.equal(details.open, false);
  } finally { disclosure.dispose(); dom.window.close(); }
});

test("sustained streamed execution output opens after the delay then honors the minimum visible dwell", async () => {
  const { dom, disclosure, details } = fixture();
  try {
    disclosure.update(details, true, true, true);
    await tick(20);
    assert.equal(details.open, true);
    // Thinking retains a card that was already auto-opened, but cannot open one.
    disclosure.update(details, true, false, true);
    await tick(20);
    assert.equal(details.open, true);
    disclosure.update(details, false, false, true);
    await tick(20);
    assert.equal(details.open, false);
  } finally { disclosure.dispose(); dom.window.close(); }
});

test("auto-open callback fires only after sustained streamed execution output", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const expanded = new Map<string, boolean>();
  const opened: Array<{ details: HTMLDetailsElement; wasOpen: boolean }> = [];
  const disclosure = new ToolDisclosureController(expanded, 15, details => opened.push({ details, wasOpen: details.open }));
  const details = createToolDetails(dom.window.document, expanded, "call-1");
  dom.window.document.body.append(details);
  try {
    disclosure.update(details, true, false, true);
    await tick(20);
    assert.equal(opened.length, 0);
    disclosure.update(details, true, true, true);
    await tick(20);
    assert.deepEqual(opened.map(card => ({ sameCard: card.details === details, wasOpen: card.wasOpen })), [{ sameCard: true, wasOpen: false }]);
  } finally { disclosure.dispose(); dom.window.close(); }
});

test("manual disclosure choices cancel pending automatic open and close", async () => {
  const { dom, disclosure, expanded, details } = fixture();
  try {
    disclosure.update(details, true, true, true);
    details.open = true;
    await tick(0);
    assert.equal(expanded.get("call-1"), true);
    await tick(20);
    assert.equal(details.open, true);

    details.open = false;
    await tick(0);
    expanded.clear();
    disclosure.update(details, true, true, true);
    await tick(20);
    assert.equal(details.open, true);
    await tick(0);
    details.open = false;
    await tick(0);
    assert.equal(expanded.get("call-1"), false);
    disclosure.update(details, false, false, true);
    await tick(20);
    assert.equal(details.open, false);
  } finally { disclosure.dispose(); dom.window.close(); }
});
