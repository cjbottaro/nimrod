import { marked, type Token } from 'marked';
import { MARKDOWN_OPTIONS } from './pi/safe-markdown';

/** Half-open range of top-level Markdown blocks; equal boundaries keep nothing. */
export interface ResponseTrim { start: number; end: number; }

export function responseMarkdown(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(normalized, MARKDOWN_OPTIONS);
  const blocks: { tokenIndex: number; start: number; end: number }[] = [];
  const crlf = /\r\n/g;
  let next = crlf.exec(source), extra = 0;
  const originalOffset = (offset: number) => {
    while (next && next.index - extra < offset) {
      extra++;
      next = crlf.exec(source);
    }
    return offset + extra;
  };
  let cursor = 0;
  for (const [tokenIndex, token] of tokens.entries()) {
    if (!token.raw.length) return undefined;
    let start = cursor;
    if (!normalized.startsWith(token.raw, start)) {
      // Marked consumes reference definitions without emitting block tokens.
      start = normalized.indexOf(token.raw, cursor);
      if (start < 0 || marked.lexer(normalized.slice(cursor, start), MARKDOWN_OPTIONS).some(token => token.type !== 'space')) {
        // If parser internals ever produce synthetic raw text, do not clip at guessed offsets.
        return undefined;
      }
    }
    cursor = start + token.raw.length;
    if (token.type !== 'space') blocks.push({ tokenIndex, start: originalOffset(start), end: originalOffset(cursor) });
  }
  if (!blocks.length) return undefined;
  const full = { start: 0, end: blocks.length };
  const valid = (trim: ResponseTrim | null | undefined): trim is ResponseTrim => !!trim
    && Number.isInteger(trim.start) && Number.isInteger(trim.end)
    && trim.start >= 0 && trim.start <= trim.end && trim.end <= full.end;
  return {
    full,
    valid,
    source({ start, end }: ResponseTrim): string {
      if (start === end) return '';
      return source.slice(start === 0 ? 0 : blocks[start].start, end === full.end ? source.length : blocks[end - 1].end);
    },
    tokens({ start, end }: ResponseTrim): Token[] {
      // Keep the original lexer context for reference links and nested Markdown.
      return start === end ? [] : tokens.slice(blocks[start].tokenIndex, blocks[end - 1].tokenIndex + 1);
    },
  };
}
