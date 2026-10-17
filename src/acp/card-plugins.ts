import type { CardPlugin, CardPresentation, ToolCardData } from '../card-plugin-api';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, fileReadPresentation, searchPresentation, argumentRecord, firstString } from '../card-plugin-ui';

function isCopilot(data: Readonly<ToolCardData>): boolean {
  return data.source?.backend === 'acp' && ['copilot', 'copilot-cli'].includes((data.source.agent || '').toLowerCase());
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
function searchScope(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value) && value.length && value.every(path => typeof path === 'string' && path.trim())) return value.join(' · ');
}

// Callbacks receive immutable snapshots. Reuse the existing flattened string after checking it
// once per rawOutput object, avoiding repeated serialization on lifecycle-only updates.
const serializedOutputs = new WeakMap<object, string>();
function copilotSections(data: Readonly<ToolCardData>): CardPresentation['sections'] {
  const sections = rawToolPresentation(data).sections;
  const native = object(data.native), output = object(native?.rawOutput);
  if (data.isError || !native || !output || typeof output.content !== 'string'
    || (native.content != null && (!Array.isArray(native.content) || native.content.length > 0))) return sections;
  let serialized = serializedOutputs.get(output);
  if (serialized === undefined) serialized = JSON.stringify(output, null, 2);
  return sections.map(section => {
    if (section.text !== serialized) return section;
    serializedOutputs.set(output, section.text);
    return { ...section, text: output.content as string };
  });
}

/** Standards-based fallback needs no agent-specific installation or tool schema. */
export const acpToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.tool', supports: data => data.source?.backend === 'acp',
  mount: () => ({ update: data => rawToolPresentation(data), dispose() {} }),
});
/** Optional Copilot adapter. Parsing is deliberately separate from Pi's Bash plugin. */
export const copilotShellPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.copilot-shell', supports: data => isCopilot(data) && data.kind === 'execute',
  mount: () => ({ update(data) {
    const raw = rawToolPresentation(data);
    return shellPresentation({ title: raw.title, command: firstString(argumentRecord(data.arguments), ['command', 'cmd']), sections: raw.sections });
  }, dispose() {} }),
});
/** Category-level selection stays fixed while incomplete read/find inputs arrive. */
export const copilotReadPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.copilot-read', supports: data => isCopilot(data) && data.kind === 'read',
  mount: () => ({ update(data) {
    const input = argumentRecord(data.arguments);
    if (typeof input?.path === 'string' && input.path.trim()) {
      return fileReadPresentation({ path: input.path, range: requestedRange(input.view_range), sections: copilotSections(data) });
    }
    if (typeof input?.pattern === 'string' && searchScope(input.paths)) {
      return searchPresentation({ title: 'Find files', query: input.pattern, scope: searchScope(input.paths), sections: copilotSections(data) });
    }
    return rawToolPresentation(data);
  }, dispose() {} }),
});
/** Copilot currently categorizes local grep calls as other, not search. */
export const copilotSearchPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.copilot-search', supports: data => isCopilot(data) && ['other', 'search'].includes(data.kind || 'other'),
  mount: () => ({ update(data) {
    const input = argumentRecord(data.arguments);
    if (typeof input?.pattern !== 'string' || typeof input.output_mode !== 'string') return rawToolPresentation(data);
    return searchPresentation({ query: input.pattern, scope: searchScope(input.paths), glob: typeof input.glob === 'string' ? input.glob : undefined,
      sections: copilotSections(data) });
  }, dispose() {} }),
});
export function bundledAcpPlugin(data: Readonly<ToolCardData>): CardPlugin {
  return [copilotShellPlugin, copilotReadPlugin, copilotSearchPlugin].find(plugin => plugin.supports(data)) || acpToolPlugin;
}
