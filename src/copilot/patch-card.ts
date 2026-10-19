import type { CardPresentation, ToolCardData } from '../card-plugin-api';
import { displayFilePath, namedToolPresentation } from '../card-plugin-ui';

interface RequestedPatch { paths: string[]; text: string; }
/** Inspect the native patch envelope only; never reconstruct files or apply edits. */
function requestedPatch(value: unknown): RequestedPatch | undefined {
  if (typeof value !== 'string') return;
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') return;
  const paths: string[] = [];
  for (const line of lines) {
    const file = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (file) { paths.push(file[1]); continue; }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && paths.length) { paths.push(move[1]); continue; }
    if (line.startsWith('***') && line !== '*** End of File') return;
  }
  return paths.length ? { paths: [...new Set(paths)], text: value } : undefined;
}

/** One bounded input cache per mounted invocation, including during lifecycle-only updates. */
export function createPatchPresentation() {
  let previous: unknown, requested: RequestedPatch | undefined;
  return (data: Readonly<ToolCardData>, projectDirectory: string | undefined,
    sections: CardPresentation['sections'], reportedDiff?: string): CardPresentation => {
    if (data.arguments !== previous) { previous = data.arguments; requested = requestedPatch(previous); }
    const paths = requested?.paths.map(path => displayFilePath(path, projectDirectory));
    const preview = paths?.length === 1 ? paths[0] : paths?.length ? `${paths[0]} · ${paths.length} paths` : undefined;
    // Only the adapter supplies exact-match, successful terminal native diffs.
    // Keeping the same key retains the viewport through requested → reported content.
    const diff = reportedDiff ?? requested?.text;
    const patch = diff !== undefined ? [{ key: 'patch', label: reportedDiff !== undefined ? 'Applied patch' : 'Requested patch', text: diff, format: 'diff' as const }] : [];
    return namedToolPresentation({ title: 'Apply patch', preview, sections: [...patch, ...sections] });
  };
}
