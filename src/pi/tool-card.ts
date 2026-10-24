import { acpToolPlugin } from '../acp/card-plugins';
import { bundledCopilotPlugin } from '../copilot/card-plugins';
import { type CardRenderer } from './card-renderer';
import { DomCardController, presentationPlugin, type DomCardRenderer, type CardDomHost } from './dom-card-renderer';
import { associateOutputViewport, createCardSummary, setCardSummaryLabel } from './card-shell';
import { renderLiteralOutput } from './literal-output';
import { sectionOutputSource } from './output-source';
import { bundledToolRenderer } from './card-plugins/registry';
import { rawToolPresentation } from './tool-presentation';
export { toolInputPreview } from './tool-presentation';
export { TOOL_AUTO_DISCLOSURE_MS, createToolDetails, setToolDetailsAutoOpen, captureStreamingOutput, restoreStreamingOutput } from './card-shell';
export type { ToolOutputScrollState } from './card-shell';

import type { ToolCardData as ToolCardBlock } from '../card-plugin-api';
export type { ToolCardData as ToolCardBlock } from '../card-plugin-api';
export type ToolCardRenderer = DomCardRenderer<ToolCardBlock> | CardRenderer<ToolCardBlock>;
const renderers = new WeakMap<HTMLDetailsElement, DomCardController<ToolCardBlock>>();
const retained = new WeakMap<HTMLDetailsElement, ToolCardBlock>();
const inputs = new WeakMap<HTMLDetailsElement, { value: unknown; label?: string; field?: string }>();

export function disposeToolCard(details: HTMLDetailsElement): void {
  renderers.get(details)?.dispose(); renderers.delete(details); retained.delete(details); inputs.delete(details); associateOutputViewport(details);
}
export function toolCardIsBusy(block: ToolCardBlock): boolean {
  const status = toolStatus(block); return status === 'running' || status === 'thinking';
}
export function renderToolCard(document: Document, block: ToolCardBlock, details: HTMLDetailsElement,
  renderer: ToolCardRenderer = block.source?.backend === 'copilot-sdk' ? bundledCopilotPlugin(block) : block.source?.backend === 'acp' ? acpToolPlugin : bundledToolRenderer(block), report?: (error: unknown) => void, host: CardDomHost = {}): HTMLDetailsElement {
  disposeToolCard(details); details.classList.add('tool-card');
  const summary = createCardSummary(document);
  const row = document.createElement('span'); row.className = 'tool-card-summary';
  const content = document.createElement('span'); content.className = 'card-plugin-summary';
  row.append(content); summary.append(row);
  const body = document.createElement('div'); body.className = 'card-plugin-body';
  details.append(summary, body);
  const plugin = 'apiVersion' in renderer ? renderer : presentationPlugin(renderer);
  renderers.set(details, new DomCardController(plugin, content, body, rawToolPresentation, { ...host, report: report ?? host.report,
    afterUpdate: () => syncRawRecovery(document, details, retained.get(details) ?? block),
  }));
  updateToolCard(document, details, block); return details;
}
export function updateToolCard(document: Document, details: HTMLDetailsElement, block: ToolCardBlock): void {
  const name = string(block.title) || string(block.name) || 'tool'; const status = toolStatus(block);
  const summary = directChild<HTMLElement>(details, 'summary');
  const row = summary?.querySelector<HTMLElement>('.tool-card-summary');
  if (!summary || !row) return;
  summary.setAttribute('aria-label', `${name} (${status})`);
  let indicator = Array.from(row.children).find(child => child.classList.contains('tool-card-spinner') || child.classList.contains('tool-card-dot'));
  const className = ['running', 'pending', 'thinking'].includes(status) ? 'tool-card-spinner' : `tool-card-dot tool-card-${status}`;
  if (!indicator || indicator.className !== className) {
    const next = document.createElement('span'); next.className = className; next.setAttribute('aria-hidden', 'true');
    if (indicator) indicator.replaceWith(next); else row.prepend(next); indicator = next;
  }
  let phase = directChild<HTMLElement>(details, '.tool-phase');
  if (status === 'stopped') {
    if (!phase) { phase = document.createElement('div'); phase.className = 'tool-phase'; summary.after(phase); }
    phase.textContent = 'Execution was interrupted before completion was reported.';
  } else phase?.remove();
  retained.set(details, block);
  updateInputs(document, details, block.arguments);
  renderers.get(details)?.update(block, { streaming: toolCardIsBusy(block) });
  const description = summary.querySelector('.card-plugin-summary')?.getAttribute('aria-label');
  if (description) summary.setAttribute('aria-label', `${description} (${status})`);
  const body = directChild<HTMLElement>(details, '.card-plugin-body');
  const recovery = directChild<HTMLElement>(details, '.tool-raw-output');
  const raw = [...Array.from(body?.querySelectorAll<HTMLElement>('.tool-section') ?? []), ...Array.from(recovery?.querySelectorAll<HTMLElement>('.tool-section') ?? [])].filter(section => ['execution', 'result'].includes(section.dataset.outputKind || ''));
  associateOutputViewport(details, raw.find(section => section.querySelector('.tool-output-streaming'))?.querySelector<HTMLElement>('.tool-output') || raw[0]?.querySelector<HTMLElement>('.tool-output') || body?.querySelector<HTMLElement>('.tool-output') || undefined);
}
function updateInputs(document: Document, root: HTMLDetailsElement, value: unknown): void {
  const body = directChild<HTMLElement>(root, '.card-plugin-body');
  const field = body?.dataset.inputField, requestedLabel = body?.dataset.inputLabel;
  const previous = inputs.get(root);
  if (previous && previous.value === value && previous.field === field && previous.label === requestedLabel) return;
  inputs.set(root, { value, field, label: requestedLabel });
  const existing = directChild<HTMLDetailsElement>(root, 'details.tool-raw-inputs:not(.tool-raw-output)');
  if (value === undefined || value === '') { existing?.remove(); return; }
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const source = field && record && Object.keys(record).length === 1 && Object.hasOwn(record, field) && typeof record[field] === 'string' ? record[field] as string : undefined;
  const label = source !== undefined ? requestedLabel || 'Raw inputs' : 'Raw inputs';
  const text = source ?? stringify(value);
  if (existing) { setCardSummaryLabel(existing.querySelector('summary')!, label); const pre = existing.querySelector('pre'); if (pre && pre.textContent !== text) pre.textContent = text; return; }
  const input = rawInputs(document, text); setCardSummaryLabel(input.querySelector('summary')!, label);
  root.insertBefore(input, directChild(root, '.card-plugin-body') || null);
}

function syncRawRecovery(document: Document, details: HTMLDetailsElement, block: ToolCardBlock): void {
  updateInputs(document, details, block.arguments);
  const expected = rawToolPresentation(block).sections;
  const body = directChild<HTMLElement>(details, '.card-plugin-body')!;
  const inputs = directChild<HTMLDetailsElement>(details, 'details.tool-raw-inputs:not(.tool-raw-output)');
  if (inputs) {
    if (body.dataset.rawInputsPlacement === 'after') { if (body.nextElementSibling !== inputs) body.after(inputs); }
    else if (inputs.nextElementSibling !== body) body.before(inputs);
  }
  // Arbitrary mounted plugins can customize even helper-rendered sections.
  // Only pure presentation adapters/core fallback may trust source bookkeeping.
  const provided = renderers.get(details)?.coversRawSections(expected) ?? expected.every(part => Array.from(body.querySelectorAll<HTMLElement>('.tool-section')).some(section =>
    section.dataset.outputKind === part.key && section.querySelector('.tool-output')?.textContent === part.text));
  let recovery = directChild<HTMLDetailsElement>(details, '.tool-raw-output');
  if (provided || !expected.length) { if (recovery) recovery.hidden = true; return; }
  if (!recovery) {
    recovery = document.createElement('details'); recovery.className = 'tool-raw-output tool-raw-inputs';
    const summary = createCardSummary(document, 'Raw output'); recovery.append(summary); details.append(recovery);
  }
  recovery.hidden = false;
  const old = new Map(Array.from(recovery.querySelectorAll<HTMLElement>('.tool-section')).map(section => [section.dataset.outputKind!, section]));
  for (const part of expected) {
    let section = old.get(part.key);
    if (!section) { section = document.createElement('div'); section.className = 'tool-section'; section.dataset.outputKind = part.key; section.append(document.createElement('pre')); recovery.append(section); }
    const output = section.querySelector('pre')!;
    output.className = `tool-output ${toolCardIsBusy(block) ? 'tool-output-streaming' : 'tool-output-final'}`;
    output.tabIndex = 0; output.setAttribute('aria-label', part.label);
    renderLiteralOutput(output, part.text, sectionOutputSource(block, part.key, part.text));
    old.delete(part.key);
  }
  for (const stale of old.values()) stale.remove();
}

function rawInputs(document: Document, value: unknown): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "tool-raw-inputs";
  const summary = createCardSummary(document, 'Raw inputs');
  const pre = document.createElement("pre");
  pre.textContent = stringify(value);
  details.append(summary, pre);
  return details;
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
