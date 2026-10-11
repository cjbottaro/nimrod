import { CardRendererController, type CardRenderer, type CardPresentation } from './card-renderer';
import { defaultToolRenderer, rawToolPresentation } from './tool-presentation';
export { toolInputPreview } from './tool-presentation';
export { TOOL_AUTO_DISCLOSURE_MS, createToolDetails, setToolDetailsAutoOpen, captureStreamingOutput, restoreStreamingOutput } from './card-shell';
export type { ToolOutputScrollState } from './card-shell';

export interface ToolCardBlock {
  name?: unknown;
  arguments?: unknown;
  uiPhase?: "thinking" | "stopped";
  executionOutput?: string;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: "running" | "finished" | "result";
}

const renderers = new WeakMap<HTMLDetailsElement, CardRendererController<ToolCardBlock>>();

export function disposeToolCard(details: HTMLDetailsElement): void {
  renderers.get(details)?.dispose();
  renderers.delete(details);
}

export function toolCardIsBusy(block: ToolCardBlock): boolean {
  const status = toolStatus(block);
  return status === "running" || status === "thinking";
}

export function renderToolCard(document: Document, block: ToolCardBlock, details: HTMLDetailsElement, renderer: CardRenderer<ToolCardBlock> = defaultToolRenderer, report?: (error: unknown) => void): HTMLDetailsElement {
  disposeToolCard(details);
  renderers.set(details, new CardRendererController(renderer, rawToolPresentation, report));
  details.classList.add("tool-card");
  const summary = document.createElement("summary");
  const summaryContent = document.createElement("span");
  summaryContent.className = "tool-card-summary";
  summary.append(summaryContent);
  details.append(summary);
  updateToolCard(document, details, block);
  return details;
}

/**
 * Updates a card in place. In particular, a running indicator stays in its
 * connected summary so its CSS animation timeline is never restarted by a
 * streaming snapshot.
 */
export function updateToolCard(document: Document, details: HTMLDetailsElement, block: ToolCardBlock): void {
  const name = string(block.name) || "tool";
  const status = toolStatus(block);
  const summary = directChild<HTMLElement>(details, "summary");
  const summaryContent = summary?.querySelector<HTMLElement>(".tool-card-summary");
  if (!summary || !summaryContent) return;

  summary.setAttribute("aria-label", `${name} (${status})`);
  let indicator = summaryContent.querySelector<HTMLElement>(".tool-card-spinner, .tool-card-dot");
  const indicatorClass = status === "running" || status === "pending" || status === "thinking" ? "tool-card-spinner" : `tool-card-dot tool-card-${status}`;
  if (!indicator || indicator.className !== indicatorClass) {
    const next = document.createElement("span");
    next.className = indicatorClass;
    next.setAttribute("aria-hidden", "true");
    if (indicator) indicator.replaceWith(next);
    else summaryContent.prepend(next);
    indicator = next;
  }

  let title = summaryContent.querySelector<HTMLElement>(".tool-card-title");
  if (!title) {
    title = document.createElement("span");
    title.className = "tool-card-title";
    summaryContent.append(title);
  }
  let renderer = renderers.get(details);
  if (!renderer) { renderer = new CardRendererController(defaultToolRenderer, rawToolPresentation); renderers.set(details, renderer); }
  const presentation = renderer.update(block);
  title.textContent = presentation.title;

  const preview = summaryContent.querySelector<HTMLElement>('.tool-card-preview');
  if (presentation.preview !== undefined) {
    if (preview) preview.textContent = presentation.preview;
    else {
      const next = document.createElement('span'); next.className = 'tool-card-preview';
      next.textContent = presentation.preview; summaryContent.append(next);
    }
  } else preview?.remove();

  let phase = directChild<HTMLElement>(details, ".tool-phase");
  if (status === "stopped") {
    if (!phase) {
      phase = document.createElement("div");
      phase.className = "tool-phase";
      summary.after(phase);
    }
    phase.textContent = "Execution was interrupted before completion was reported.";
  } else phase?.remove();
  updateInputs(document, details, block.arguments);
  updateOutputs(document, details, block, presentation);
}

function updateInputs(document: Document, root: HTMLDetailsElement, argumentsValue: unknown): void {
  const existing = directChild<HTMLDetailsElement>(root, "details.tool-raw-inputs");
  if (argumentsValue === undefined || argumentsValue === "") {
    existing?.remove();
    return;
  }
  if (existing) {
    const pre = existing.querySelector("pre");
    if (pre) pre.textContent = stringify(argumentsValue);
    return;
  }
  const inputs = rawInputs(document, argumentsValue);
  const firstOutput = directChild<HTMLElement>(root, ".tool-section");
  root.insertBefore(inputs, firstOutput || null);
}

function updateOutputs(document: Document, root: HTMLDetailsElement, block: ToolCardBlock, presentation: CardPresentation): void {
  const desired = presentation.sections.map(section => ({ kind: section.key, label: section.label, value: section.text, streaming: toolCardIsBusy(block) }));
  const sections = (): HTMLElement[] => (Array.from(root.children) as HTMLElement[]).filter((child) => child.classList.contains("tool-section"));
  const existing = new Map(sections().map((section) => [section.dataset.outputKind || "", section]));

  desired.forEach((part, index) => {
    let section = existing.get(part.kind);
    if (!section) {
      section = outputSection(document, part.label, part.value, part.streaming, part.kind);
    } else {
      section.querySelector<HTMLElement>(".tool-label")!.textContent = part.label;
      const output = section.querySelector<HTMLPreElement>(".tool-output")!;
      output.className = `tool-output ${part.streaming ? "tool-output-streaming" : "tool-output-final"}`;
      if (output.textContent !== part.value) output.textContent = part.value;
      existing.delete(part.kind);
    }
    const current = sections()[index];
    if (current !== section) root.insertBefore(section, current || null);
  });
  for (const section of existing.values()) section.remove();
}

function rawInputs(document: Document, value: unknown): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "tool-raw-inputs";
  const summary = document.createElement("summary");
  summary.textContent = "Raw inputs";
  const pre = document.createElement("pre");
  pre.textContent = stringify(value);
  details.append(summary, pre);
  return details;
}

function outputSection(document: Document, label: string, value: string, streaming: boolean, kind: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "tool-section";
  root.dataset.outputKind = kind;
  const heading = document.createElement("div");
  heading.className = "tool-label";
  heading.textContent = label;
  const pre = document.createElement("pre");
  pre.className = `tool-output ${streaming ? "tool-output-streaming" : "tool-output-final"}`;
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", label);
  pre.textContent = value;
  root.append(heading, pre);
  return root;
}

function toolStatus(block: ToolCardBlock): "running" | "thinking" | "stopped" | "failed" | "succeeded" | "pending" {
  if (block.isError === true) return "failed";
  if (block.uiPhase === "stopped") return "stopped";
  if (block.uiPhase === "thinking") return "thinking";
  if (block.toolStatus === "running") return "running";
  if (block.toolStatus === "finished" || block.toolStatus === "result") return "succeeded";
  return "pending";
}

function directChild<T extends HTMLElement>(root: HTMLElement, selector: string): T | undefined {
  return Array.from(root.children).find((child) => child.matches(selector)) as T | undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return "[unserializable arguments]"; }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
