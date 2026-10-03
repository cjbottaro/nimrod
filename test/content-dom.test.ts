import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { reconcileContentBlock } from "../src/pi/content-dom";

test("repeated text updates replace rather than duplicate rendered user content", () => {
  const dom = new JSDOM("<article><div>Hello</div><details>tool</details></article>");
  const document = dom.window.document;
  const parent = document.querySelector("article")!;
  const tool = parent.lastElementChild as HTMLElement;
  for (let i = 0; i < 4; i++) {
    const previous = parent.firstElementChild as HTMLElement;
    const next = document.createElement("div");
    next.textContent = "Hello";
    reconcileContentBlock(parent, previous, next, previous);
    assert.equal(parent.children.length, 2);
    assert.equal(parent.textContent, "Hellotool");
    assert.equal(parent.lastElementChild, tool);
    reconcileContentBlock(parent, tool, tool, tool);
    assert.equal(tool.isConnected, true);
  }
  dom.window.close();
});

test("empty reasoning removes its old block without inserting undefined", () => {
  const dom = new JSDOM("<article><details>reasoning</details><div>answer</div></article>");
  const parent = dom.window.document.querySelector("article")!;
  const reasoning = parent.firstElementChild as HTMLElement;
  reconcileContentBlock(parent, reasoning, undefined, reasoning);
  assert.equal(parent.children.length, 1);
  assert.equal(parent.textContent, "answer");
  dom.window.close();
});
