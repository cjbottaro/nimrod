import { marked, type Token } from 'marked';
import { MARKDOWN_OPTIONS } from './pi/safe-markdown';

/** Inclusive, zero-based range of top-level rendered Markdown blocks. */
export interface ResponseTrim { first: number; last: number; }

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
  if (blocks.length < 2) return undefined;
  const lastBlock = blocks.length - 1;
  const full = { first: 0, last: lastBlock };
  const valid = (trim: ResponseTrim | null | undefined): trim is ResponseTrim => !!trim
    && Number.isInteger(trim.first) && Number.isInteger(trim.last)
    && trim.first >= 0 && trim.first <= trim.last && trim.last <= lastBlock;
  return {
    full,
    valid,
    source({ first, last }: ResponseTrim): string {
      return source.slice(first === 0 ? 0 : blocks[first].start, last === lastBlock ? source.length : blocks[last].end);
    },
    tokens({ first, last }: ResponseTrim): Token[] {
      // Keep the original lexer context for reference links and nested Markdown.
      return tokens.slice(blocks[first].tokenIndex, blocks[last].tokenIndex + 1);
    },
  };
}
