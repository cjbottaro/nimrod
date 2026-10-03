import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { parseSkillInvocation } from "../src/pi/skill-invocation";
import { webviewHtml, rendererBundle } from "./view-fixture";

const body = "References are relative to /skills/review.\n\n# Review instructions\n\nRead every changed file.";
const block = `<skill name="review" location="/skills/review/SKILL.md">\n${body}\n</skill>`;
const invocation = `${block}\n\nCheck the **diff**.`;

test("skill parser recognizes only Pi's complete expanded message format", () => {
  assert.deepEqual(parseSkillInvocation(invocation), { name: "review", location: "/skills/review/SKILL.md", content: body, userMessage: "Check the **diff**." });
  assert.equal(parseSkillInvocation(block)?.userMessage, undefined);
  for (const text of ["/skill:review", "plain text", `Example:\n${invocation}`, `\`\`\`\n${invocation}\n\`\`\``, block.replace("</skill>", ""), block.replace(' location="/skills/review/SKILL.md"', "")]) {
    assert.equal(parseSkillInvocation(text), undefined);
  }
});

function fixture() {
  const dom = new JSDOM(webviewHtml("nonce", "script", "vscode-webview://test", {}), { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  const frames: FrameRequestCallback[] = [];
  win.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  win.eval(rendererBundle() + `\nPiView.mountPiView({ getState: () => undefined, setState: () => {}, postMessage: () => {}, onMessage: listener => window.addEventListener('message', event => listener(event.data)) });`);
  const snapshot = (messages: unknown[]) => {
    win.dispatchEvent(new win.MessageEvent("message", { data: { type: "snapshot", state: { status: "Ready", messages } } }));
    while (frames.length) frames.shift()!(0);
  };
  return { dom, win, snapshot };
}

for (const arrayContent of [false, true]) test(`bundled skill turns collapse the body and preserve disclosure (${arrayContent ? "blocks" : "string"})`, () => {
  const { dom, win, snapshot } = fixture();
  try {
    const content = arrayContent ? [{ type: "text", text: invocation }] : invocation;
    const message = { key: "user-1", role: "user", content };
    const original = JSON.stringify(message);
    snapshot([message]);
    const article = win.document.querySelector("article.user")!;
    const details = article.querySelector<HTMLDetailsElement>(".skill-card")!;
    assert.equal(win.document.querySelectorAll("article").length, 1);
    assert.equal(details.open, false);
    assert.equal(details.querySelector("summary")!.textContent, "/skill:review");
    assert.equal(details.querySelector(".skill-body")!.textContent, ""); // Lazy, not merely CSS-hidden.
    assert.equal(article.querySelector(".skill-invocation > .markdown")!.textContent!.trim(), "Check the diff.");
    assert.equal(article.querySelectorAll("strong").length, 1);
    assert.equal(article.textContent!.includes(body), false);
    details.open = true;
    details.dispatchEvent(new win.Event("toggle"));
    assert.equal(details.querySelector(".skill-location")!.textContent, "/skills/review/SKILL.md");
    assert.match(details.querySelector(".skill-body")!.textContent!, /Review instructions/);
    // Both unrelated streaming and a changed message signature preserve the live node.
    snapshot([{ ...message, timestamp: 2 }, { key: "assistant", role: "assistant", content: [{ type: "text", text: "Working" }] }]);
    assert.equal(win.document.querySelector(".skill-card"), details);
    assert.equal(details.isConnected, true);
    assert.equal(details.open, true);
    details.open = false;
    details.dispatchEvent(new win.Event("toggle"));
    snapshot([{ ...message, timestamp: 3 }]);
    assert.equal(win.document.querySelector(".skill-card"), details);
    assert.equal(details.open, false);
    assert.equal(JSON.stringify(message), original);
  } finally { dom.window.close(); }
});

test("skill-only history has no empty argument area, assistant/example text remains ordinary", () => {
  const { dom, win, snapshot } = fixture();
  try {
    snapshot([
      { key: "history-user", role: "user", content: [{ type: "text", text: block }, { type: "image", data: "ignored" }] },
      { key: "assistant", role: "assistant", content: invocation },
      { key: "example", role: "user", content: `Example:\n${invocation}` },
    ]);
    assert.equal(win.document.querySelectorAll(".skill-card").length, 1);
    assert.equal(win.document.querySelector(".skill-invocation > .markdown"), null);
    assert.match(win.document.querySelector("article.user")!.textContent!, /\[image\]/);
    assert.match(win.document.querySelector("article.assistant")!.textContent!, /Review instructions/);
    assert.equal(win.document.querySelector<HTMLDetailsElement>(".skill-card")!.open, false);
  } finally { dom.window.close(); }
});

test("skill labels and locations are text, and expanded Markdown remains sanitized", () => {
  const { dom, win, snapshot } = fixture();
  try {
    snapshot([{ key: "unsafe", role: "user", content: '<skill name="<img src=x onerror=alert(1)>" location="<script>alert(1)</script>">\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n</skill>' }]);
    const details = win.document.querySelector<HTMLDetailsElement>(".skill-card")!;
    details.open = true;
    details.dispatchEvent(new win.Event("toggle"));
    assert.equal(details.querySelector("summary")!.textContent, "/skill:<img src=x onerror=alert(1)>");
    assert.equal(details.querySelector("script, img, [onerror], [href^='javascript:']"), null);
    assert.equal(details.querySelector(".skill-location")!.textContent, "<script>alert(1)</script>");
  } finally { dom.window.close(); }
});
