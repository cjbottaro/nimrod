import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderReasoningCard, updateReasoningCard } from "../src/pi/reasoning-card";

function document(): Document {
  return new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true }).window.document;
}

function renderMarkdown(doc: Document, text: string): HTMLElement {
  const root = doc.createElement("div");
  root.className = "markdown";
  root.textContent = text;
  return root;
}

test("reasoning DOM shows Pi-provided text and preserves the user's disclosure toggle across rerenders", async () => {
  const doc = document();
  const expanded = new Map<string, boolean>();
  const key = "assistant-1:thinking:0";
  const first = renderReasoningCard(doc, expanded, key, "streamed reasoning", (text) => renderMarkdown(doc, text));
  assert.ok(first);
  doc.body.append(first);
  assert.equal(first.querySelector(".tool-card-title")?.textContent, "Reasoning");
  assert.equal(first.querySelector(".reasoning-preview")?.textContent, "streamed reasoning");
  assert.equal(first.querySelector(".markdown")?.textContent, "streamed reasoning");
  assert.equal(first.open, false);

  first.open = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(expanded.get(key), true);

  const rerendered = renderReasoningCard(doc, expanded, key, "final reasoning", (text) => renderMarkdown(doc, text));
  assert.ok(rerendered);
  assert.equal(rerendered.open, true);
  assert.equal(rerendered.querySelector(".markdown")?.textContent, "final reasoning");
});

test("reasoning retains its live spinner and first-line preview then turns green", () => {
  const doc = document();
  const render = (text: string) => renderMarkdown(doc, text);
  const card = renderReasoningCard(doc, new Map(), "r", "\nFirst line\nMore", render, true)!;
  doc.body.append(card);
  card.open = true;
  const spinner = card.querySelector(".tool-card-spinner");
  updateReasoningCard(card, "\nFirst line\nMore reasoning arrives", render, true);
  assert.equal(card.querySelector(".tool-card-spinner"), spinner);
  assert.equal(card.querySelector(".reasoning-preview")?.textContent, "First line");
  assert.equal(card.open, true);
  updateReasoningCard(card, "\nFirst line\nFull reasoning", render, false);
  assert.ok(card.querySelector(".tool-card-succeeded"));
  assert.equal(card.querySelector(".tool-card-spinner"), null);
  assert.equal(card.querySelector(".reasoning-body")?.textContent, "\nFirst line\nFull reasoning");
});

test("empty or opaque persisted reasoning creates no empty disclosure", () => {
  const doc = document();
  const expanded = new Map<string, boolean>();
  assert.equal(renderReasoningCard(doc, expanded, "empty", "", (text) => renderMarkdown(doc, text)), undefined);
  assert.equal(renderReasoningCard(doc, expanded, "opaque", undefined, (text) => renderMarkdown(doc, text)), undefined);
});
