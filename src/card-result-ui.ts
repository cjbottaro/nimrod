import type { CardPresentation } from './card-plugin-api';

/** Small shared summaries; adapters retain ownership of native tool schemas. */
export function namedToolPresentation(value: { title: string; preview?: string; sections: CardPresentation['sections'] }): CardPresentation {
  return { ...value, rawInputsPlacement: 'after' };
}
export interface CodeSearchFile { path: string; fragments: readonly string[]; }
/** Literal snippets, not inferred source line numbers, Markdown or applied-file content. */
export function codeSearchText(value: { files: readonly CodeSearchFile[]; totalCount?: number; incomplete?: boolean; notice?: string }): string {
  const count = value.files.length;
  const total = typeof value.totalCount === 'number' && Number.isSafeInteger(value.totalCount) && value.totalCount >= count ? value.totalCount : undefined;
  const heading = total !== undefined && total !== count ? `${count} of ${total} results returned` : `${count} result${count === 1 ? '' : 's'} returned`;
  return [heading, value.notice, value.incomplete ? 'Results may be incomplete (reported by server).' : undefined,
    ...value.files.map(file => [file.path, ...file.fragments].join('\n'))].filter(value => value !== undefined).join('\n\n');
}
