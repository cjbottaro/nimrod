import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tokens } from 'marked';
import { responseMarkdown } from '../src/response-markdown';

const code = '```ts\r\nconst name = "🌙";\r\n```';
const source = `# Heading\r\n\r\nParagraph\r\n\r\n- one\r\n  - nested\r\n- two\r\n\r\n${code}\r\n\r\n| a |\r\n| --- |\r\n| b |\r\n\r\n> quote\r\n\r\nLast\r\n`;

test('response trim snaps to complete top-level GFM blocks and copies exact source bytes', () => {
  const markdown = responseMarkdown(source)!;
  assert.deepEqual(markdown.full, { first: 0, last: 6 });
  assert.equal(markdown.source(markdown.full), source);
  assert.deepEqual(markdown.tokens(markdown.full).filter(token => token.type !== 'space').map(token => token.type),
    ['heading', 'paragraph', 'list', 'code', 'table', 'blockquote', 'paragraph']);
  const trimmed = markdown.source({ first: 3, last: 3 });
  assert.ok(trimmed.startsWith(code));
  assert.match(trimmed.slice(code.length), /^(?:\r\n)*$/);
  assert.equal(markdown.valid({ first: 3, last: 2 }), false);
  assert.equal(markdown.valid({ first: 0, last: 7 }), false);
  assert.equal(responseMarkdown(code), undefined, 'a single fenced block cannot be trimmed');
});

test('references outside the kept range still render as links without polluting copied source', () => {
  const text = '# Heading\n\n[where]: https://example.com/\n\n[Link][where]\n\nLast';
  const markdown = responseMarkdown(text)!;
  const trim = { first: 1, last: 1 };
  assert.equal(markdown.source(trim), '[Link][where]');
  assert.equal((markdown.tokens(trim)[0] as Tokens.Paragraph).tokens[0]?.type, 'link');
});
