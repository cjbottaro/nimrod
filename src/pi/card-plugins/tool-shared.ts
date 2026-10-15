import type { CardPlugin, CardPresentation, ToolCardData } from '../../card-plugin-api';
import { presentationPlugin } from '../dom-card-renderer';
import { normalizedToolName } from './tool-input';

export function rawToolPresentation(block: Readonly<ToolCardData>): CardPresentation {
  const sections: CardPresentation['sections'][number][] = [];
  if (block.executionOutput && block.resultOutput && block.executionOutput !== block.resultOutput) {
    sections.push({ key: 'execution', label: 'Live output', text: block.executionOutput });
  }
  const output = block.resultOutput || block.executionOutput;
  if (output) sections.push({ key: 'result', label: block.toolStatus === 'running' && !block.resultOutput ? 'Live output' : 'Result', text: output });
  return { title: typeof block.name === 'string' && block.name || 'tool', sections };
}

/** Pure presentation adapter: same public mount/update/dispose/context API as external plugins. */
export function toolPlugin(id: string, tools: readonly string[], present: (data: Readonly<ToolCardData>) => CardPresentation): CardPlugin {
  const plugin = presentationPlugin<ToolCardData>({
    id, supports: data => tools.includes(normalizedToolName(data.name)),
    mount: () => ({ update: present, dispose() {} }),
  });
  // Preserve adapter identity so raw recovery can use registered source coverage, not DOM scans.
  return Object.assign(plugin, { tools });
}
