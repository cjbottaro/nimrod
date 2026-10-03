import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createMainActivityDom, createSubagentActivityDom, renderMainActivity, renderSubagentActivity } from "../src/pi/activity-dom";
import { webviewHtml } from "./view-fixture";

test("activity updates retain the spinner node so streaming updates do not restart its animation", () => {
  const document = new JSDOM("<div id='activity'></div>").window.document;
  const root = document.getElementById("activity")!;
  const activity = createMainActivityDom(root);
  const spinner = activity.spinner;
  renderMainActivity(activity, { busy: true, text: "Working…" });
  renderMainActivity(activity, { busy: true, text: "Running read…" });
  assert.equal(activity.spinner, spinner);
  assert.equal(root.firstElementChild, spinner);
  assert.equal(activity.spinner.hidden, false);
  assert.equal(activity.text.textContent, "Running read…");
  assert.equal(activity.text.className, "main-activity-text");
});

test("recognized subagent snapshots retain the spinner beside the count row", () => {
  const document = new JSDOM("<div id='subagents' hidden></div>").window.document;
  const root = document.getElementById("subagents")!;
  const activity = createSubagentActivityDom(root);
  const spinner = activity.spinner;
  renderSubagentActivity(activity, "1 running, 2 queued agents");
  renderSubagentActivity(activity, "2 running, 1 queued agent");

  assert.equal(activity.spinner, spinner);
  assert.equal(root.firstElementChild, spinner);
  assert.equal(root.hidden, false);
  assert.equal(activity.text.textContent, "2 running, 1 queued agent");
  assert.equal(activity.text.className, "subagent-activity-text");

  renderSubagentActivity(activity, undefined);
  assert.equal(root.hidden, true);
  assert.equal(activity.spinner, spinner);
});

test("actual stylesheet hides the idle main spinner while background activity remains visible", () => {
  const dom = new JSDOM(webviewHtml("nonce", "script", "vscode-webview://test", {}), { pretendToBeVisual: true });
  const document = dom.window.document;
  document.getElementById("activity")!.hidden = false;
  const mainRoot = document.getElementById("main-activity")!;
  mainRoot.hidden = false;
  const main = createMainActivityDom(mainRoot);
  const background = createSubagentActivityDom(document.getElementById("subagent-activity")!);
  const spinner = main.spinner;

  renderMainActivity(main, { busy: true, text: "Working…" });
  assert.equal(dom.window.getComputedStyle(spinner).display, "inline-block");
  renderSubagentActivity(background, "1 running agent");
  renderMainActivity(main, { busy: false, text: "Idle — ready for your message" });
  assert.equal(spinner.hidden, true);
  assert.equal(dom.window.getComputedStyle(spinner).display, "none");
  assert.equal(dom.window.getComputedStyle(background.root).display, "flex");
  assert.equal(dom.window.getComputedStyle(background.spinner).display, "inline-block");

  renderSubagentActivity(background, undefined);
  assert.equal(dom.window.getComputedStyle(background.root).display, "none");
  renderMainActivity(main, { busy: true, text: "Working…" });
  assert.equal(main.spinner, spinner);
  assert.equal(dom.window.getComputedStyle(spinner).display, "inline-block");
  dom.window.close();
});

test("a real producer status makes the subagent row and spinner visible at a fixed size", () => {
  const dom = new JSDOM(webviewHtml("nonce", "script", "vscode-webview://test", {}), { pretendToBeVisual: true });
  const root = dom.window.document.getElementById("subagent-activity")!;
  const activity = createSubagentActivityDom(root);
  renderSubagentActivity(activity, "2 running agents");

  const style = dom.window.getComputedStyle(activity.spinner);
  assert.equal(root.hidden, false);
  assert.equal(activity.spinner.hidden, false);
  assert.equal(style.display, "inline-block");
  assert.equal(style.width, "9px");
  assert.equal(style.height, "9px");
  assert.equal(style.flexShrink, "0");
});
