import { bashInputPreview } from './bash';
import { readInputPreview } from './read';
import { writeInputPreview } from './write';
import { grepInputPreview } from './grep';
import { findInputPreview } from './find';
import { lsInputPreview } from './ls';
import { argumentRecord, fieldCountPreview, fileInputPreview, firstString, namedStrings, normalizedToolName, searchInputPreview } from './tool-input';

/** Same tool-owned previews in cards, generic overrides and the parallel-tools overview. */
const previews = new Map<string, (args: unknown, complete: boolean) => string | undefined>([
  ['read', readInputPreview], ['write', writeInputPreview], ['edit', fileInputPreview],
  ['bash', bashInputPreview], ['shell', bashInputPreview], ['terminal', bashInputPreview],
  ['grep', grepInputPreview], ['find', findInputPreview], ['ls', lsInputPreview],
  ['search', searchInputPreview], ['glob', searchInputPreview],
]);

export function toolInputPreview(name: string, args: unknown, complete = true): string | undefined {
  if (args === undefined || args === '') return undefined;
  const normalized = normalizedToolName(name);
  const preview = previews.get(normalized);
  if (preview) return preview(args, complete);
  const record = argumentRecord(args);
  if (!record && !complete) return undefined;
  if (['agent', 'subagent', 'sub-agent', 'sub_agent'].includes(normalized)) {
    return firstString(record, ['description']) || (complete ? 'No description provided' : undefined);
  }
  if (normalized === 'steer_subagent') return firstString(record, ['message']) || (complete ? 'No message provided' : undefined);
  if (normalized === 'web_search' || normalized === 'web-search') return namedStrings(record, 'query', 'queries') || (complete ? 'Search inputs' : undefined);
  if (normalized === 'fetch_content' || normalized === 'fetch-content') return namedStrings(record, 'url', 'urls') || (complete ? 'Fetch inputs' : undefined);
  return fieldCountPreview(args, complete);
}
