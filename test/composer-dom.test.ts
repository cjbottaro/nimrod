import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { keyboardHint, keyboardSubmissionMode, renderPrimaryAction, resizeComposer } from "../src/pi/composer-dom";
import { webviewHtml } from "./view-fixture";

function documentWithComposer(): Document {
  return new JSDOM("<button id='send'></button>").window.document;
}

test("composer primary action is Send while idle or background-only, and Stop only for main-agent work", () => {
  const document = documentWithComposer();
  const send = document.getElementById("send") as HTMLButtonElement;

  renderPrimaryAction(send, { mainBusy: false, submissionPending: false, sessionUnavailable: false });
  assert.equal(send.dataset.action, "send");
  assert.equal(send.disabled, false);
  assert.equal(send.getAttribute("aria-label"), "Send message");
  assert.ok(send.querySelector("svg"));

  renderPrimaryAction(send, { mainBusy: true, submissionPending: true, sessionUnavailable: false });
  assert.equal(send.dataset.action, "stop");
  assert.equal(send.disabled, false, "a pending submission must not disable Stop");
  assert.equal(send.getAttribute("aria-label"), "Stop Pi");

  renderPrimaryAction(send, { mainBusy: false, submissionPending: false, sessionUnavailable: false });
  assert.equal(send.dataset.action, "send", "background activity does not replace Send with Stop");
  assert.equal(send.disabled, false);

  renderPrimaryAction(send, { mainBusy: false, submissionPending: true, sessionUnavailable: false });
  assert.equal(send.disabled, true, "normal sends remain protected while acceptance is pending or unknown");
});

test("Enter steers and Option-Enter queues only while working, preserving newline and IME input", () => {
  const event = (overrides: Partial<Parameters<typeof keyboardSubmissionMode>[0]> = {}) => ({
    key: "Enter", shiftKey: false, altKey: false, isComposing: false, keyCode: 0, ...overrides,
  });

  assert.equal(keyboardSubmissionMode(event(), false), "normal");
  assert.equal(keyboardSubmissionMode(event(), true), "steer");
  assert.equal(keyboardSubmissionMode(event({ altKey: true }), true), "followUp");
  assert.equal(keyboardSubmissionMode(event({ altKey: true }), false), "normal");
  assert.equal(keyboardSubmissionMode(event({ altKey: true, shiftKey: true }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ altKey: true, isComposing: true }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ altKey: true, keyCode: 229 }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ shiftKey: true }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ isComposing: true }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ keyCode: 229 }), true), undefined);
  assert.equal(keyboardSubmissionMode(event({ key: "a" }), true), undefined);
  assert.equal(keyboardHint(false), "Enter to send · Shift+Enter for newline");
  assert.equal(keyboardHint(true), "Enter to steer · Option-Enter to queue · Shift+Enter for newline");
});

test("composer auto-resizes to a capped height and scrolls only beyond the cap", () => {
  const document = documentWithComposer();
  const prompt = document.createElement("textarea");
  Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 72 });
  resizeComposer(prompt, 40, 120);
  assert.equal(prompt.style.height, "72px");
  assert.equal(prompt.style.overflowY, "hidden");

  Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 260 });
  resizeComposer(prompt, 40, 120);
  assert.equal(prompt.style.height, "120px");
  assert.equal(prompt.style.overflowY, "auto");

  Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 38 });
  resizeComposer(prompt, 40, 120);
  assert.equal(prompt.style.height, "40px", "cleared or shortened drafts shrink back to the floor");
  assert.equal(prompt.style.overflowY, "hidden");
});

test("composer measurement holds the shell height until the final field height is applied", () => {
  const document = documentWithComposer();
  const shell = document.createElement("div");
  shell.dataset.piId = "composer-shell";
  const prompt = document.createElement("textarea");
  shell.append(prompt);
  document.body.append(shell);
  Object.defineProperty(shell, "offsetHeight", { value: 140 });
  Object.defineProperty(prompt, "scrollHeight", { get: () => {
    assert.equal(prompt.style.height, "40px", "measurement must not stretch to the held flex shell");
    assert.equal(shell.style.height, "140px", "forced measurement cannot resize the transcript pane");
    return 138;
  } });
  resizeComposer(prompt);
  assert.equal(prompt.style.height, "138px");
  assert.equal(shell.style.height, "");
});

test("prompt disables native autocorrect and writing suggestions while retaining spellcheck", () => {
  const document = new JSDOM(webviewHtml()).window.document;
  const prompt = document.getElementById("prompt") as HTMLTextAreaElement;
  assert.equal(prompt.getAttribute("autocorrect"), "off");
  assert.equal(prompt.getAttribute("autocomplete"), "off");
  assert.equal(prompt.getAttribute("writingsuggestions"), "false");
  assert.notEqual(prompt.getAttribute("spellcheck"), "false");
});

test("webview keeps runtime status in the bottom controls; Rename is available through /name", () => {
  const document = new JSDOM(webviewHtml("nonce", "script", "vscode-webview://test", {})).window.document;
  assert.equal(document.querySelector("header"), null);
  assert.ok(document.getElementById("activity"));
  assert.ok(document.getElementById("composer-shell"));
  assert.equal(document.getElementById("model-controls"), null);
  assert.equal(document.getElementById("status-controls")?.parentElement?.id, "main-activity");
  assert.equal(document.getElementById("model")?.getAttribute("aria-label"), "Select model");
  assert.equal(document.getElementById("thinking")?.getAttribute("aria-label"), "Select thinking level");
  assert.equal(document.getElementById("stop"), null);
  assert.equal(document.getElementById("send-mode"), null);
  assert.equal(document.querySelector("select"), null);
  assert.equal(document.getElementById("keyboard-hint")?.textContent, "Enter to send · Shift+Enter for newline");
  assert.equal(document.getElementById("more-actions"), null);
  assert.equal(document.getElementById("session-menu"), null);
  assert.equal(document.getElementById("rename"), null);
});
