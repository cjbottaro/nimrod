import { DomCardController, type CardDomHost } from './dom-card-renderer';
import { reasoningDomRenderer } from './card-plugins/reasoning';
import { createCardSummary } from './card-shell';
const instances = new WeakMap<HTMLDetailsElement, DomCardController<string>>();
export function disposeReasoningCard(details: HTMLDetailsElement): void { instances.get(details)?.dispose(); instances.delete(details); }
export type ReasoningRenderer = (thinking: string) => HTMLElement;

export function renderReasoningCard(document: Document, expanded: Map<string, boolean>, key: string, thinking: unknown,
  render: ReasoningRenderer, streaming = false, host: CardDomHost = {}): HTMLDetailsElement | undefined {
  if (typeof thinking !== 'string' || !thinking.trim()) return undefined;
  const details = document.createElement('details'); details.className = 'tool-card reasoning-card'; details.dataset.detailKey = key;
  details.open = expanded.get(key) ?? false;
  details.addEventListener('toggle', () => expanded.set(key, details.open));
  const summary = createCardSummary(document);
  const row = document.createElement('span'); row.className = 'tool-card-summary';
  const indicator = document.createElement('span'); indicator.className = 'reasoning-indicator'; indicator.setAttribute('aria-hidden', 'true');
  const content = document.createElement('span'); content.className = 'card-plugin-summary';
  row.append(indicator, content); summary.append(row);
  const body = document.createElement('div'); body.className = 'reasoning-body';
  details.append(summary, body);
  instances.set(details, new DomCardController(reasoningDomRenderer, content, body,
    text => ({ title: 'Reasoning', sections: [{ key: 'reasoning', label: 'Reasoning', text }] }), { ...host, markdown: render }));
  updateReasoningCard(details, thinking, render, streaming); return details;
}
export function updateReasoningCard(details: HTMLDetailsElement, thinking: string, _render: ReasoningRenderer, streaming: boolean): void {
  const indicator = details.querySelector<HTMLElement>('.reasoning-indicator')!;
  const className = `reasoning-indicator ${streaming ? 'tool-card-spinner' : 'tool-card-dot tool-card-succeeded'}`;
  if (indicator.className !== className) indicator.className = className;
  details.querySelector('summary')!.setAttribute('aria-label', `Reasoning (${streaming ? 'streaming' : 'complete'})`);
  instances.get(details)?.update(thinking, { streaming });
}
