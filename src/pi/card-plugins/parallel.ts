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
