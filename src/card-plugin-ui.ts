/** Public runtime building blocks. Bundled and external plugins use this same module. */
import type { CardPlugin, CardPresentation, ToolCardData } from './card-plugin-api';
import { normalizedToolName } from './pi/card-plugins/tool-input';
export { argumentRecord, firstString, fieldCountPreview, normalizedToolName } from './pi/card-plugins/tool-input';

const purePresentations = new WeakSet<object>();
/** Host bookkeeping only; separately bundled copies simply use conservative raw inspection. */
export function isPresentationPlugin(plugin: object): boolean { return purePresentations.has(plugin); }
export function definePresentationPlugin<Data>(definition: {
  id: string;
  supports(data: Readonly<Data>): boolean;
  mount(): { update(data: Readonly<Data>): CardPresentation; dispose(): void };
}): CardPlugin<Data> {
  const plugin: CardPlugin<Data> = { apiVersion: 2, id: definition.id, supports: data => definition.supports(data), mount(context) {
    const instance = definition.mount();
    return { update(data) { context.renderPresentation(instance.update(data)); }, dispose: () => instance.dispose() };
  } };
  purePresentations.add(plugin);
  return plugin;
}
export function defineToolPlugin(id: string, tools: readonly string[], present: (data: Readonly<ToolCardData>) => CardPresentation): CardPlugin {
  return Object.assign(definePresentationPlugin<ToolCardData>({ id, supports: data => tools.includes(normalizedToolName(data.name)), mount: () => ({ update: present, dispose() {} }) }), { tools });
}
export function rawToolPresentation(block: Readonly<ToolCardData>): CardPresentation {
  const sections: CardPresentation['sections'][number][] = [];
  if (block.executionOutput && block.resultOutput && block.executionOutput !== block.resultOutput) sections.push({ key: 'execution', label: 'Live output', text: block.executionOutput });
  const output = block.resultOutput || block.executionOutput;
  if (output) sections.push({ key: 'result', label: block.toolStatus === 'running' && !block.resultOutput ? 'Live output' : 'Result', text: output });
  return { title: block.title || (typeof block.name === 'string' && block.name) || 'tool', sections };
}
/** Shared command/output component through the public keyed presentation runtime. */
export function shellPresentation(value: { title: string; command?: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { title: value.title, preview: value.command, sections: value.sections.map(section => ({ ...section, format: 'console' as const })) };
}
