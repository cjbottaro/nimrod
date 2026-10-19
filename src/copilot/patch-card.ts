import type { CardPresentation, ToolCardData } from '../card-plugin-api';
import { displayFilePath, namedToolPresentation } from '../card-plugin-ui';

type DiffStats = NonNullable<CardPresentation['diffStats']>;
interface RequestedPatch { paths: string[]; text: string; stats?: DiffStats; }
/** Inspect the native patch envelope only; never reconstruct files or apply edits. */
function requestedPatch(value: unknown): RequestedPatch | undefined {
  if (typeof value !== 'string') return;
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') return;
  const paths: string[] = [];
  let added = 0, removed = 0, countsKnown = true;
  for (const line of lines) {
    const file = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (file) {
      paths.push(file[2]);
      // Delete requests omit the old contents, so their removed-line count is unknown.
      if (file[1] === 'Delete') countsKnown = false;
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && paths.length) { paths[paths.length - 1] = move[1]; continue; }
    if (line.startsWith('***') && line !== '*** End of File') return;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
    else if (!line.startsWith(' ') && !line.startsWith('@@') && line !== '*** End of File') countsKnown = false;
  }
  return paths.length ? { paths: [...new Set(paths)], text: value, stats: countsKnown ? { added, removed } : undefined } : undefined;
}

/** Count only unified-diff hunk lines: +++/--- file headers are not changes. */
function reportedPatch(value: string): { files: number; stats?: DiffStats } {
  let files = 0, added = 0, removed = 0, oldLeft = 0, newLeft = 0, valid = true;
  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) { files++; if (oldLeft || newLeft) valid = false; oldLeft = newLeft = 0; continue; }
    if (/^(?:Binary files |GIT binary patch)/.test(line)) valid = false;
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (oldLeft || newLeft) valid = false;
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (!Number.isSafeInteger(oldLeft) || !Number.isSafeInteger(newLeft)) valid = false;
      continue;
    }
    if ((!oldLeft && !newLeft) || line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+')) { added++; newLeft--; }
    else if (line.startsWith('-')) { removed++; oldLeft--; }
    else if (line.startsWith(' ')) { oldLeft--; newLeft--; }
    else valid = false;
    if (oldLeft < 0 || newLeft < 0) valid = false;
  }
  return { files, stats: valid && !oldLeft && !newLeft ? { added, removed } : undefined };
}

/** One bounded input/result cache per mounted invocation, including lifecycle-only updates. */
export function createPatchPresentation() {
  let previous: unknown, requested: RequestedPatch | undefined;
  let previousDiff: string | undefined, reported: ReturnType<typeof reportedPatch> | undefined;
  return (data: Readonly<ToolCardData>, projectDirectory: string | undefined,
    sections: CardPresentation['sections'], reportedDiff?: string): CardPresentation => {
    if (data.arguments !== previous) { previous = data.arguments; requested = requestedPatch(previous); }
    if (reportedDiff !== previousDiff) { previousDiff = reportedDiff; reported = reportedDiff === undefined ? undefined : reportedPatch(reportedDiff); }
    const fileCount = requested?.paths.length ?? reported?.files;
    const preview = fileCount === 1 && requested?.paths.length === 1 ? displayFilePath(requested.paths[0], projectDirectory)
      : fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : undefined;
    // Only the adapter supplies exact-match, successful terminal native diffs.
    // Keeping the same key retains the viewport through requested → reported content.
    const diff = reportedDiff ?? requested?.text;
    const patch = diff !== undefined ? [{ key: 'patch', label: reportedDiff !== undefined ? 'Applied patch' : 'Requested patch', text: diff, format: 'diff' as const }] : [];
    return namedToolPresentation({ title: 'Apply patch', preview, diffStats: reported ? reported.stats : requested?.stats, sections: [...patch, ...sections] });
  };
}
