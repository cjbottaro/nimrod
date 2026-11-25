import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tokens } from 'marked';
import { responseMarkdown } from '../src/response-markdown';

const code = '```ts\r\nconst name = "🌙";\r\n```';
const source = `# Heading\r\n\r\nParagraph\r\n\r\n- one\r\n  - nested\r\n- two\r\n\r\n${code}\r\n\r\n| a |\r\n| --- |\r\n| b |\r\n\r\n> quote\r\n\r\nLast\r\n`;

test('response trim snaps to complete top-level GFM blocks and copies exact source bytes', () => {
  const markdown = responseMarkdown(source)!;
  assert.deepEqual(markdown.full, { start: 0, end: 7 });
  assert.equal(markdown.source(markdown.full), source);
  assert.deepEqual(markdown.tokens(markdown.full).filter(token => token.type !== 'space').map(token => token.type),
    ['heading', 'paragraph', 'list', 'code', 'table', 'blockquote', 'paragraph']);
  const trimmed = markdown.source({ start: 3, end: 4 });
  assert.ok(trimmed.startsWith(code));
  assert.match(trimmed.slice(code.length), /^(?:\r\n)*$/);
  assert.equal(markdown.valid({ start: 3, end: 2 }), false);
  assert.equal(markdown.valid({ start: 0, end: 8 }), false);
});

test('meeting boundaries keep no blocks, including for a single block and at either end', () => {
  const markdown = responseMarkdown(code)!;
  assert.deepEqual(markdown.full, { start: 0, end: 1 });
  for (const cut of [0, 1]) {
    const trim = { start: cut, end: cut };
    assert.equal(markdown.valid(trim), true);
    assert.equal(markdown.source(trim), '');
    assert.deepEqual(markdown.tokens(trim), []);
  }
});

test('references outside the kept range still render as links without polluting copied source', () => {
  const text = '# Heading\n\n[where]: https://example.com/\n\n[Link][where]\n\nLast';
  const markdown = responseMarkdown(text)!;
  const trim = { start: 1, end: 2 };
  assert.equal(markdown.source(trim), '[Link][where]');
  assert.equal((markdown.tokens(trim)[0] as Tokens.Paragraph).tokens[0]?.type, 'link');
});
