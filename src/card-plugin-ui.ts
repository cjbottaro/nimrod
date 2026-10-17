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
  matches?(data: Readonly<Data>): boolean;
  mount(): { update(data: Readonly<Data>): CardPresentation; dispose(): void };
}): CardPlugin<Data> {
  const plugin: CardPlugin<Data> = { apiVersion: 2, id: definition.id, matches: definition.matches, supports: data => definition.supports(data), mount(context) {
    const instance = definition.mount();
    return { update(data) { context.renderPresentation(instance.update(data)); }, dispose: () => instance.dispose() };
  } };
  purePresentations.add(plugin);
  return plugin;
}
export function defineToolPlugin(id: string, tools: readonly string[], present: (data: Readonly<ToolCardData>) => CardPresentation): CardPlugin {
  return Object.assign(definePresentationPlugin<ToolCardData>({ id, supports: data => tools.includes(normalizedToolName(data.name)), mount: () => ({ update: present, dispose() {} }) }), { tools });
}
/** Protocol-category adapter; tool names and categories remain separate. */
export function defineKindPlugin(id: string, kinds: readonly string[], present: (data: Readonly<ToolCardData>) => CardPresentation): CardPlugin {
  return Object.assign(definePresentationPlugin<ToolCardData>({ id, supports: data => data.source?.backend === 'acp' && kinds.includes(data.kind || 'other'), mount: () => ({ update: present, dispose() {} }) }), { kinds, targets: [{ backend: 'acp' as const }] });
}
export function rawToolPresentation(block: Readonly<ToolCardData>): CardPresentation {
  const sections: CardPresentation['sections'][number][] = [];
  if (block.executionOutput && block.resultOutput && block.executionOutput !== block.resultOutput) sections.push({ key: 'execution', label: 'Live output', text: block.executionOutput });
  const output = block.resultOutput || block.executionOutput;
  if (output) sections.push({ key: 'result', label: block.toolStatus === 'running' && !block.resultOutput ? 'Live output' : 'Result', text: output });
  return { title: block.title || (typeof block.name === 'string' && block.name) || 'tool', sections };
}
/** Compact filename-first read summary; ranges describe requested input, not returned line counts. */
export function fileReadPresentation(value: { path: string; range?: string; sections: CardPresentation['sections'] }): CardPresentation {
  const split = Math.max(value.path.lastIndexOf('/'), value.path.lastIndexOf('\\'));
  const filename = value.path.slice(split + 1) || value.path;
  const directory = split >= 0 ? value.path.slice(0, split + 1) : '';
  return { title: 'Read file', preview: [filename, value.range, directory].filter(Boolean).join(' · '), rawInputsPlacement: 'after', sections: value.sections };
}
/** Query-first search summary, shared by content and filename searches without parsing results. */
export function searchPresentation(value: { title?: string; query: string; scope?: string; glob?: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { title: value.title || 'Search', preview: [value.query || '""', value.scope ? `in ${value.scope}` : undefined, value.glob ? `files ${value.glob}` : undefined].filter(Boolean).join(' · '),
    rawInputsPlacement: 'after', sections: value.sections };
}
/** Shared command/output component through the public keyed presentation runtime. */
export function shellPresentation(value: { title: string; command?: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { title: value.title, preview: value.command, sections: value.sections.map(section => ({ ...section, format: 'console' as const })) };
}
