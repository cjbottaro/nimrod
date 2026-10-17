import type { CardPlugin, CardPresentation, CardSection, CardPluginContext, ToolCardData } from '../card-plugin-api';
import { copilotToolResult } from './tool-result';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, fileReadPresentation, searchPresentation, argumentRecord, firstString, webUrl, markdownWebLink, webSearchPresentation, webFetchPresentation, type WebSource, namedToolPresentation, codeSearchText, type CodeSearchFile } from '../card-plugin-ui';

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
  if (data.isError) {
    const errors = sections.map(section => section.key === 'result' ? { ...section, label: 'Error', format: 'text' as const } : section);
    const complete = object(object(data.native)?.['tool.execution_complete']);
    const error = object(complete?.error), result = object(complete?.result);
    const message = typeof error?.message === 'string' ? error.message : typeof result?.message === 'string' ? result.message : undefined;
    const expected = error ? serializedOutputs.get(error) ?? JSON.stringify(error, null, 2) : result ? serializedOutputs.get(result) ?? copilotToolResult(result) : undefined;
    if (message !== undefined && expected !== undefined) {
      if (error) serializedOutputs.set(error, expected); else if (result) serializedOutputs.set(result, expected);
      return errors.map(section => section.key === 'result' && section.text === expected ? { ...section, text: message } : section);
    }
    return errors;
  }
  const native = nativeResult(data);
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
  const raw = { ...rawToolPresentation(data), sections: data.isError ? copilotSections(data) : rawToolPresentation(data).sections }, native = !data.isError ? nativeResult(data) : undefined;
  const answer = native?.text !== undefined ? searchAnswer(native.output.structuredContent) : undefined;
  const sections = answer ? raw.sections.map(section => section.key === 'result' && section.text === native!.source
    ? { ...section, label: 'Answer', text: answer.text, format: 'markdown' as const, webLinks: true } : section) : raw.sections;
  return webSearchPresentation({ query, sections, sources: answer?.sources });
}
function fetchSections(data: Readonly<ToolCardData>, requestedUrl: string): CardPresentation['sections'] {
  if (data.isError) return copilotSections(data);
  const sections = rawToolPresentation(data).sections, native = nativeResult(data);
  if (!native) return sections;
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

const repositoryResults = new WeakMap<object, string | null>();
function repositoryResult(output: Record<string, unknown>): string | undefined {
  if (repositoryResults.has(output)) return repositoryResults.get(output) ?? undefined;
  const structured = object(output.structuredContent);
  if (!structured || !Array.isArray(structured.items)) { repositoryResults.set(output, null); return; }
  const files: CodeSearchFile[] = [];
  for (const item of structured.items) {
    const file = object(item);
    if (!file || typeof file.path !== 'string' || !file.path || file.text_matches !== undefined && !Array.isArray(file.text_matches)) { repositoryResults.set(output, null); return; }
    const fragments: string[] = [];
    for (const match of (file.text_matches as unknown[] | undefined) || []) {
      const fragment = object(match)?.fragment;
      if (typeof fragment !== 'string') { repositoryResults.set(output, null); return; }
      fragments.push(fragment);
    }
    files.push({ path: file.path, fragments });
  }
  const text = codeSearchText({ files, totalCount: typeof structured.total_count === 'number' ? structured.total_count : undefined, incomplete: structured.incomplete_results === true,
    notice: typeof output.content === 'string' && output.content.startsWith('Output too large to read at once (') && output.content.includes('Saved to:') ? 'Agent text preview was clipped; showing structured results.' : undefined });
  repositoryResults.set(output, text); return text;
}
/** Late names/categories/SDK metadata update content inside the same mounted adapter. */
function copilotPresentation(data: Readonly<ToolCardData>, context: CardPluginContext): CardPresentation {
  const raw = rawToolPresentation(data);
  if (!isCopilot(data)) return raw;
  const input = argumentRecord(data.arguments), start = object(object(data.native)?.['tool.execution_start']);
  const sections = data.isError ? copilotSections(data) : raw.sections;
  if (typeof start?.mcpServerName === 'string' && typeof start.mcpToolName === 'string') {
    if (start.mcpServerName === 'github-mcp-server' && start.mcpToolName === 'search_code' && typeof input?.query === 'string') {
      const native = !data.isError ? nativeResult(data) : undefined;
      const text = native ? repositoryResult(native.output) : undefined;
      return namedToolPresentation({ title: 'GitHub code search', preview: input.query, sections: text !== undefined
        ? raw.sections.map(section => section.key === 'result' && section.text === native!.source ? { ...section, label: 'Results', text } : section) : sections });
    }
    if (start.mcpServerName === 'github-mcp-server' && start.mcpToolName === 'get_file_contents'
      && typeof input?.owner === 'string' && typeof input.repo === 'string' && typeof input.path === 'string') {
      return namedToolPresentation({ title: 'GitHub contents', preview: `${input.owner}/${input.repo}/${input.path}`, sections: data.isError ? sections : copilotSections(data) });
    }
    return namedToolPresentation({ title: raw.title, preview: `${start.mcpServerName} · ${start.mcpToolName}`, sections });
  }
  if (data.kind === 'execute') {
    const command = firstString(input, ['command', 'cmd']);
    return data.isError ? namedToolPresentation({ title: raw.title, preview: command, sections }) : shellPresentation({ title: raw.title, command, sections });
  }
  if (data.kind === 'read') {
    if (typeof input?.path === 'string' && input.path.trim()) return fileReadPresentation({ path: input.path, projectDirectory: context.projectDirectory, range: requestedRange(input.view_range), sections: copilotSections(data) });
    if (typeof input?.pattern === 'string' && searchScope(input.paths)) return searchPresentation({ title: 'Find files', query: input.pattern, projectDirectory: context.projectDirectory, scope: searchScope(input.paths), sections: copilotSections(data) });
  }
  if (data.kind === 'search' && typeof input?.query === 'string') return webSearch(data, input.query);
  if (typeof input?.pattern === 'string' && typeof input.output_mode === 'string') return searchPresentation({ query: input.pattern, projectDirectory: context.projectDirectory,
    scope: searchScope(input.paths), glob: typeof input.glob === 'string' ? input.glob : undefined, sections: copilotSections(data) });
  if (data.kind === 'fetch') {
    const url = webUrl(input?.url);
    if (url) return webFetchPresentation({ url, startIndex: typeof input?.start_index === 'number' ? input.start_index : undefined, sections: fetchSections(data, url) });
  }
  if (data.name === 'skill' && typeof input?.skill === 'string') return namedToolPresentation({ title: 'Use skill', preview: input.skill, sections: copilotSections(data) });
  return { ...raw, sections };
}
function adapter(id: string, generic = false): CardPlugin {
  return definePresentationPlugin<ToolCardData>({ id, supports: data => generic ? data.source?.backend === 'copilot-sdk' : isCopilot(data),
    mount: context => ({ update(data) {
      const presentation = copilotPresentation(data, context);
      // Keep the retained Raw inputs node in one place through generation, execution and errors.
      return isCopilot(data) ? { ...presentation, rawInputsPlacement: 'after' as const } : presentation;
    }, dispose() {} }) });
}
export const copilotToolPlugin = adapter('nimrod.copilot.tool', true);
export const copilotShellPlugin = adapter('nimrod.copilot.shell');
export const copilotReadPlugin = adapter('nimrod.copilot.read');
export const copilotSearchPlugin = adapter('nimrod.copilot.search');
export const copilotFetchPlugin = adapter('nimrod.copilot.fetch');
export function bundledCopilotPlugin(data: Readonly<ToolCardData>): CardPlugin {
  if (!isCopilot(data)) return copilotToolPlugin;
  if (data.kind === 'execute') return copilotShellPlugin;
  if (data.kind === 'read') return copilotReadPlugin;
  if (data.kind === 'fetch') return copilotFetchPlugin;
  return ['other', 'search'].includes(data.kind || 'other') ? copilotSearchPlugin : copilotToolPlugin;
}
