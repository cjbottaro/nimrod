import type { ParallelToolCluster } from './tool-progress';
import { DomCardController, type CardDomHost } from './dom-card-renderer';
import { parallelDomRenderer } from './card-plugins/parallel';
import { createCardSummary } from './card-shell';
const instances = new WeakMap<HTMLDetailsElement, DomCardController<ParallelToolCluster>>();
export function disposeParallelCard(details: HTMLDetailsElement): void { instances.get(details)?.dispose(); instances.delete(details); }

export function renderParallelToolCard(document: Document, cluster: ParallelToolCluster,
  details = document.createElement('details'), host: CardDomHost = {}): HTMLDetailsElement {
  let summary = Array.from(details.children).find(child => child.tagName === 'SUMMARY') as HTMLElement | undefined;
  let list = Array.from(details.children).find(child => child.classList.contains('parallel-tool-list')) as HTMLElement | undefined;
  let indicator = summary?.querySelector<HTMLElement>('.parallel-indicator');
  if (!summary || !list || !indicator) {
    disposeParallelCard(details); details.replaceChildren(); details.className = 'tool-card parallel-tool-card'; details.open = true;
    summary = createCardSummary(document);
    const row = document.createElement('span'); row.className = 'tool-card-summary';
    indicator = document.createElement('span'); indicator.className = 'parallel-indicator'; indicator.setAttribute('aria-hidden', 'true');
    const content = document.createElement('span'); content.className = 'card-plugin-summary';
    row.append(indicator, content); summary.append(row);
    list = document.createElement('ul'); list.className = 'parallel-tool-list'; details.append(summary, list);
    instances.set(details, new DomCardController(parallelDomRenderer, content, list,
      data => ({ title: 'Parallel tools', sections: [{ key: 'raw', label: 'Tool activity', text: JSON.stringify(data.tools, null, 2) }] }), host));
  }
  const running = cluster.tools.some(tool => tool.status === 'running');
  indicator.className = 'parallel-indicator ' + (running ? 'tool-card-spinner' : 'tool-card-dot tool-card-succeeded');
  summary.setAttribute('aria-label', `Parallel tools — ${cluster.tools.filter(tool => tool.status === 'running').length} running`);
  instances.get(details)?.update(cluster, { streaming: running }); return details;
}
