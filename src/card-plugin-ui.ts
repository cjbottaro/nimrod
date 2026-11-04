/** Public runtime building blocks. Bundled and external plugins use this same module. */
import type { CardPlugin, CardPluginContext, CardPresentation, ToolCardData } from './card-plugin-api';
import { normalizedToolName } from './pi/card-plugins/tool-input';
import { displayFilePath } from './card-display-path';
export { displayFilePath } from './card-display-path';
export { operationPreview } from './card-operation-ui';
export { namedToolPresentation, codeSearchText } from './card-result-ui';
export type { CodeSearchFile } from './card-result-ui';
export { webUrl, displayWebUrl, markdownWebLink, constrainWebLinks, webSearchPresentation, webFetchPresentation } from './card-web-ui';
export type { WebSource } from './card-web-ui';
export { argumentRecord, firstString, fieldCountPreview, normalizedToolName } from './pi/card-plugins/tool-input';

const purePresentations = new WeakSet<object>();
/** Host bookkeeping only; separately bundled copies simply use conservative raw inspection. */
export function isPresentationPlugin(plugin: object): boolean { return purePresentations.has(plugin); }
export function definePresentationPlugin<Data>(definition: {
  id: string;
  supports(data: Readonly<Data>): boolean;
  matches?(data: Readonly<Data>): boolean;
  mount(context: CardPluginContext): { update(data: Readonly<Data>): CardPresentation; dispose(): void };
}): CardPlugin<Data> {
  const plugin: CardPlugin<Data> = { apiVersion: 2, id: definition.id, matches: definition.matches, supports: data => definition.supports(data), mount(context) {
    const instance = definition.mount(context);
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
/** Path first, then requested lines. Native arguments and results are never rewritten. */
export function fileReadPresentation(value: { path: string; projectDirectory?: string; range?: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { title: 'Read file', preview: [displayFilePath(value.path, value.projectDirectory), value.range].filter(Boolean).join(' · '), rawInputsPlacement: 'after', sections: value.sections };
}
/** Query-first search summary, shared by content and filename searches without parsing results. */
export function searchPresentation(value: { title?: string; query: string; scope?: string | readonly string[]; projectDirectory?: string; glob?: string; sections: CardPresentation['sections'] }): CardPresentation {
  const scopes = typeof value.scope === 'string' ? [value.scope] : value.scope || [];
  const scope = scopes.map(path => displayFilePath(path, value.projectDirectory)).filter(Boolean).join(' · ');
  return { title: value.title || 'Search', preview: [value.query || '""', scope ? `in ${scope}` : undefined, value.glob ? `files ${value.glob}` : undefined].filter(Boolean).join(' · '),
    rawInputsPlacement: 'after', sections: value.sections };
}
/** Read-only exchange with a speech-bubble icon and inset reply; details remain disclosed. */
export function questionAnswerPresentation(value: { question: string; answer: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { title: value.question, questionAnswer: { answer: value.answer }, rawInputsPlacement: 'after', sections: value.sections };
}
/** Match a cumulative console snapshot without throwing away live SGR styles. */
export function consoleOutputSuffix(live: string, final: string): string | undefined {
  if (!live || !final) return;
  if (final.startsWith(live)) return final.slice(live.length);
  // SGR alone does not change text positions. Never guess through cursor/progress rewrites.
  const plain = live.replace(/\x1b\[[\d;:]*m/g, '');
  if (!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(plain) && final.startsWith(plain)) return final.slice(plain.length);
}

/** Shared command/output layout. A result snapshot supersedes its earlier execution section. */
export function shellPresentation(value: { title: string; command?: string; sections: CardPresentation['sections']; format?: 'console' | 'text' }): CardPresentation {
  const execution = value.sections.find(section => section.key === 'execution');
  const result = value.sections.find(section => section.key === 'result');
  const suffix = execution && result && value.format !== 'text' ? consoleOutputSuffix(execution.text, result.text) : undefined;
  return { title: value.title, preview: value.command, rawInputsPlacement: 'after', rawOutputDisclosure: true,
    sections: value.sections.filter(section => section.key !== 'execution' || !result)
      .map(section => ({ ...section, ...(section === result && suffix !== undefined ? { text: execution!.text + suffix } : {}),
        hideLabel: true, wrap: true, format: value.format ?? 'console' })) };
}
