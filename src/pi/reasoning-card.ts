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
  label.textContent = "Reasoning";
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
  const line = thinking.split(/\r?\n/).find(line => line.trim())?.trim() || "";
  const preview = details.querySelector<HTMLElement>(".reasoning-preview")!;
  preview.textContent = line;
  preview.title = line;
  const body = details.querySelector<HTMLElement>(".reasoning-body")!;
  body.replaceChildren(render(thinking));
}
