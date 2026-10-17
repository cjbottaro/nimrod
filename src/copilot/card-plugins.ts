import type { CardPlugin, CardPresentation, CardSection, ToolCardData } from '../card-plugin-api';
import { copilotToolResult } from './tool-result';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, fileReadPresentation, searchPresentation, argumentRecord, firstString, webUrl, markdownWebLink, webSearchPresentation, webFetchPresentation, type WebSource } from '../card-plugin-ui';

function isCopilot(data: Readonly<ToolCardData>): boolean {
  return data.source?.backend === 'copilot-sdk' && ['copilot', 'copilot-cli'].includes((data.source?.agent || '').toLowerCase());
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function requestedRange(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 2) return;
  const [start, end] = value;
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end)) return;
  if (end === -1) return `from line ${start}`;
  if (end < start) return;
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}
function searchScope(value: unknown): string | string[] | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value) && value.length && value.every(path => typeof path === 'string' && path.trim())) return value as string[];
}

// Callbacks receive immutable snapshots. Reuse the existing flattened string after checking it
// once per SDK result object, avoiding repeated serialization on lifecycle-only updates.
const serializedOutputs = new WeakMap<object, string>();
function copilotSections(data: Readonly<ToolCardData>): CardPresentation['sections'] {
  const sections = rawToolPresentation(data).sections;
  const native = !data.isError ? nativeResult(data) : undefined;
  return native?.text !== undefined ? sections.map(section => section.key === 'result' && section.text === native.source ? { ...section, text: native.text as string } : section) : sections;
}

/** Only transform the exact current native result; unrelated live/standard output stays intact. */
function nativeResult(data: Readonly<ToolCardData>): { output: Record<string, unknown>; source: string; text?: string } | undefined {
  const native = object(data.native);
  const output = object(object(native?.['tool.execution_complete'])?.result);
  const source = rawToolPresentation(data).sections.find(section => section.key === 'result')?.text;
  if (!native || !output || source === undefined) return;
  const literal = serializedOutputs.get(output) ?? copilotToolResult(output);
  if (source !== literal) return;
  serializedOutputs.set(output, literal);
  return { output, source, text: typeof output.content === 'string' ? output.content : typeof output.detailedContent === 'string' ? output.detailedContent : undefined };
}
interface SearchAnswer { text: string; sources: WebSource[]; }
const searchAnswers = new WeakMap<object, SearchAnswer | null>();
function searchAnswer(value: unknown): SearchAnswer | undefined {
  const structured = object(value);
  if (!structured) return;
  if (searchAnswers.has(structured)) return searchAnswers.get(structured) || undefined;
  const text = object(structured.text);
  if (structured.type !== 'output_text' || typeof text?.value !== 'string') { searchAnswers.set(structured, null); return; }
  const answer = text.value, sources: WebSource[] = [], sourceIds = new Map<string, number>();
  const replacements: { start: number; end: number; text: string }[] = [];
  let codePointOffsets: number[] | undefined;
  for (const annotation of Array.isArray(text.annotations) ? text.annotations : []) {
    const item = object(annotation), citation = object(item?.url_citation), url = webUrl(citation?.url);
    if (!item || !citation || !url) continue;
    let number = sourceIds.get(url);
    if (number === undefined) {
      sources.push({ url, title: typeof citation.title === 'string' && citation.title.trim() ? citation.title : new URL(url).hostname });
      number = sources.length; sourceIds.set(url, number);
    }
    const rawStart = item.start_index, rawEnd = item.end_index;
    if (typeof rawStart !== 'number' || typeof rawEnd !== 'number' || !Number.isSafeInteger(rawStart) || !Number.isSafeInteger(rawEnd) || rawStart < 0 || rawEnd <= rawStart) continue;
    let start = rawStart, end = rawEnd;
    const marker = /^【[^【】\r\n]+†source】$/;
    if (!marker.test(answer.slice(start, end))) {
      // Some producers count Unicode code points rather than JavaScript UTF-16 units.
      if (!codePointOffsets) {
        codePointOffsets = [0];
        for (const point of answer) codePointOffsets.push(codePointOffsets[codePointOffsets.length - 1] + point.length);
      }
      if (end >= codePointOffsets.length) continue;
      const mappedStart = codePointOffsets[start], mappedEnd = codePointOffsets[end];
      if (!marker.test(answer.slice(mappedStart, mappedEnd))) continue;
      start = mappedStart; end = mappedEnd;
    }
    if (end <= answer.length) replacements.push({ start, end, text: markdownWebLink(`[${number}]`, url) });
  }
  replacements.sort((a, b) => a.start - b.start);
  let result = '', position = 0;
  for (const replacement of replacements) {
    if (replacement.start < position) continue;
    result += answer.slice(position, replacement.start) + replacement.text; position = replacement.end;
  }
  const parsed = { text: result + answer.slice(position), sources };
  searchAnswers.set(structured, parsed); return parsed;
}
function webSearch(data: Readonly<ToolCardData>, query: string): CardPresentation {
  const raw = rawToolPresentation(data), native = !data.isError ? nativeResult(data) : undefined;
  const answer = native?.text !== undefined ? searchAnswer(native.output.structuredContent) : undefined;
  const sections = answer ? raw.sections.map(section => section.key === 'result' && section.text === native!.source
    ? { ...section, label: 'Answer', text: answer.text, format: 'markdown' as const, webLinks: true } : section) : raw.sections;
  return webSearchPresentation({ query, sections, sources: answer?.sources });
}
function fetchSections(data: Readonly<ToolCardData>, requestedUrl: string): CardPresentation['sections'] {
  const sections = rawToolPresentation(data).sections, native = nativeResult(data);
  if (!native) return sections;
  if (data.isError) {
    return native.output.code === 'failure' && typeof native.output.message === 'string'
      ? sections.map(section => section.key === 'result' && section.text === native.source ? { ...section, label: 'Error', text: native.output.message as string } : section) : sections;
  }
  if (native.text === undefined) return sections;
  let text = native.text;
  const rawPrefix = /^Content type [^\r\n]+ cannot be simplified to markdown\. Here is the raw content:\r?\n/.exec(text);
  if (rawPrefix) text = text.slice(rawPrefix[0].length);
  const header = /^Contents of (https?:\/\/\S+?)(?: \(redirected from (https?:\/\/\S+?)\))?:\r?\n/.exec(text);
  const url = webUrl(header?.[1]), from = webUrl(header?.[2]);
  if (!header || !url || (url !== requestedUrl && from !== requestedUrl)) return sections;
  text = text.slice(header[0].length);
  const partial = /\n*<note>(Content truncated\. Call the fetch tool with a start_index of \d+ to get more content\.)<\/note>\s*$/.exec(text);
  if (partial) text = text.slice(0, partial.index);
  const result: CardSection[] = [];
  if (url !== requestedUrl) result.push({ key: 'fetch-redirect', label: 'Redirected to', text: markdownWebLink(url, url), format: 'markdown', webLinks: true });
  result.push({ key: 'result', label: rawPrefix ? 'Raw content' : 'Content', text, format: rawPrefix ? 'text' : 'markdown',
    ...(rawPrefix ? {} : { webLinks: true, baseUrl: url }) });
  if (partial) result.push({ key: 'fetch-partial', label: 'Partial content', text: partial[1] });
  return sections.flatMap(section => section.key === 'result' && section.text === native.source ? result : [section]);
}

/** Copilot operations without a bespoke presentation retain their literal output. */
export const copilotToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.copilot.tool', supports: data => data.source?.backend === 'copilot-sdk',
  mount: () => ({ update: data => rawToolPresentation(data), dispose() {} }),
});
/** Optional Copilot adapter. Parsing is deliberately separate from Pi's Bash plugin. */
export const copilotShellPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.copilot.shell', supports: data => isCopilot(data) && data.kind === 'execute',
  mount: () => ({ update(data) {
    const raw = rawToolPresentation(data);
    return shellPresentation({ title: raw.title, command: firstString(argumentRecord(data.arguments), ['command', 'cmd']), sections: raw.sections });
  }, dispose() {} }),
});
/** Category-level selection stays fixed while incomplete read/find inputs arrive. */
export const copilotReadPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.copilot.read', supports: data => isCopilot(data) && data.kind === 'read',
  mount: context => ({ update(data) {
    const input = argumentRecord(data.arguments);
    if (typeof input?.path === 'string' && input.path.trim()) {
      return fileReadPresentation({ path: input.path, projectDirectory: context.projectDirectory, range: requestedRange(input.view_range), sections: copilotSections(data) });
    }
    if (typeof input?.pattern === 'string' && searchScope(input.paths)) {
      return searchPresentation({ title: 'Find files', query: input.pattern, projectDirectory: context.projectDirectory, scope: searchScope(input.paths), sections: copilotSections(data) });
    }
    return rawToolPresentation(data);
  }, dispose() {} }),
});
/** Local grep and web search retain separate payload parsing within search categories. */
export const copilotSearchPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.copilot.search', supports: data => isCopilot(data) && ['other', 'search'].includes(data.kind || 'other'),
  mount: context => ({ update(data) {
    const input = argumentRecord(data.arguments);
    if (data.kind === 'search' && typeof input?.query === 'string') return webSearch(data, input.query);
    if (typeof input?.pattern !== 'string' || typeof input.output_mode !== 'string') return rawToolPresentation(data);
    return searchPresentation({ query: input.pattern, projectDirectory: context.projectDirectory, scope: searchScope(input.paths), glob: typeof input.glob === 'string' ? input.glob : undefined,
      sections: copilotSections(data) });
  }, dispose() {} }),
});
export const copilotFetchPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.copilot.fetch', supports: data => isCopilot(data) && data.kind === 'fetch',
  mount: () => ({ update(data) {
    const input = argumentRecord(data.arguments), url = webUrl(input?.url);
    if (!url) return rawToolPresentation(data);
    return webFetchPresentation({ url, startIndex: typeof input?.start_index === 'number' ? input.start_index : undefined, sections: fetchSections(data, url) });
  }, dispose() {} }),
});
export function bundledCopilotPlugin(data: Readonly<ToolCardData>): CardPlugin {
  return [copilotShellPlugin, copilotReadPlugin, copilotSearchPlugin, copilotFetchPlugin].find(plugin => plugin.supports(data)) || copilotToolPlugin;
}
