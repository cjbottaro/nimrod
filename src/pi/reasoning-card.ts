import { CardRendererController } from './card-renderer';
import { defaultReasoningRenderer } from './card-plugins/reasoning';
const instances = new WeakMap<HTMLDetailsElement, CardRendererController<string>>();
export function disposeReasoningCard(details: HTMLDetailsElement): void { instances.get(details)?.dispose(); instances.delete(details); }

export type ReasoningRenderer = (thinking: string) => HTMLElement;

/** Renders only text Pi supplied, never opaque reasoning signatures. */
export function renderReasoningCard(
  document: Document,
  expanded: Map<string, boolean>,
  key: string,
  thinking: unknown,
  render: ReasoningRenderer,
  streaming = false,
): HTMLDetailsElement | undefined {
  if (typeof thinking !== "string" || !thinking.trim()) return undefined;
  const details = document.createElement("details");
  details.className = "tool-card reasoning-card";
  details.dataset.detailKey = key;
  details.open = expanded.get(key) ?? false;
  details.addEventListener("toggle", () => expanded.set(key, details.open));
  const summary = document.createElement("summary");
  const row = document.createElement("span");
  row.className = "tool-card-summary";
  const indicator = document.createElement("span");
  indicator.className = "reasoning-indicator";
  indicator.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "tool-card-title";
  label.textContent = 'Reasoning';
  const preview = document.createElement("span");
  preview.className = "tool-card-preview reasoning-preview";
  row.append(indicator, label, preview);
  summary.append(row);
  const body = document.createElement("div");
  body.className = "reasoning-body";
  details.append(summary, body);
  updateReasoningCard(details, thinking, render, streaming);
  return details;
}

/** Preserve the connected indicator and disclosure while text changes. */
export function updateReasoningCard(details: HTMLDetailsElement, thinking: string, render: ReasoningRenderer, streaming: boolean): void {
  const indicator = details.querySelector<HTMLElement>(".reasoning-indicator")!;
  const className = `reasoning-indicator ${streaming ? "tool-card-spinner" : "tool-card-dot tool-card-succeeded"}`;
  if (indicator.className !== className) indicator.className = className;
  details.querySelector("summary")!.setAttribute("aria-label", `Reasoning (${streaming ? "streaming" : "complete"})`);
  let instance = instances.get(details);
  if (!instance) {
    instance = new CardRendererController(defaultReasoningRenderer, text => ({ title: 'Reasoning', sections: [{ key: 'reasoning', label: 'Reasoning', text }] }));
    instances.set(details, instance);
  }
  const presentation = instance.update(thinking);
  details.querySelector<HTMLElement>('.tool-card-title')!.textContent = presentation.title;
  const line = presentation.preview || '';
  const preview = details.querySelector<HTMLElement>(".reasoning-preview")!;
  preview.textContent = line;
  const body = details.querySelector<HTMLElement>(".reasoning-body")!;
  const section = presentation.sections[0];
  if (section?.format === 'markdown') body.replaceChildren(render(section.text));
  else body.textContent = section?.text || '';
}
