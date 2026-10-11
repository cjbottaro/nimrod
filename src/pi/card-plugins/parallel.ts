import type { DomCardRenderer } from '../dom-card-renderer';
import type { CardRenderer } from '../card-renderer';
import type { ParallelToolCluster } from '../tool-progress';
import { toolInputPreview } from './tool';

export const defaultParallelRenderer: CardRenderer<ParallelToolCluster> = {
  id: 'nimrod.parallel', supports: () => true,
  mount: () => ({
    update: cluster => ({ title: 'Parallel tools', sections: [],
      members: [...cluster.tools].sort((a, b) => (a.status === 'running' ? 1 : 0) - (b.status === 'running' ? 1 : 0))
        .map(tool => ({ key: tool.id, title: tool.name, preview: toolInputPreview(tool.name, tool.arguments) || '' })),
    }),
    dispose() {},
  }),
};

export const parallelDomRenderer: DomCardRenderer<ParallelToolCluster> = {
  apiVersion: 2, id: 'nimrod.parallel', supports: () => true,
  mount(context) {
    const doc = context.document;
    const title = doc.createElement('span'); title.className = 'parallel-title'; title.textContent = 'Parallel tools'; context.summary.append(title);
    return { update(cluster) {
      const ordered = [...cluster.tools].sort((a, b) => (a.status === 'running' ? 1 : 0) - (b.status === 'running' ? 1 : 0));
      const existing = new Map(Array.from(context.body.children).map(node => [(node as HTMLElement).dataset.toolId!, node as HTMLElement]));
      ordered.forEach((tool, index) => {
        let row = existing.get(tool.id);
        if (!row) {
          row = doc.createElement('li'); row.dataset.toolId = tool.id; row.className = 'parallel-tool-row';
          const indicator = doc.createElement('span'); indicator.className = 'member-indicator'; indicator.setAttribute('aria-hidden', 'true');
          const name = doc.createElement('span'); name.className = 'tool-card-title';
          const preview = doc.createElement('span'); preview.className = 'tool-card-preview';
          row.append(indicator, name, preview);
        }
        const indicator = row.querySelector<HTMLElement>('.member-indicator')!;
        indicator.className = 'member-indicator ' + (tool.status === 'running' ? 'tool-card-spinner' : tool.status === 'done' ? 'tool-card-dot tool-card-succeeded' : tool.status === 'failed' ? 'tool-card-dot tool-card-failed' : 'tool-card-dot');
        row.querySelector('.tool-card-title')!.textContent = tool.name;
        row.querySelector('.tool-card-preview')!.textContent = toolInputPreview(tool.name, tool.arguments) || '';
        if (context.body.children[index] !== row) context.body.insertBefore(row, context.body.children[index] || null);
        existing.delete(tool.id);
      });
      for (const stale of existing.values()) stale.remove();
    }, dispose() {} };
  },
};
