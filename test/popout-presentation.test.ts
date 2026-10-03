import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { isMarkdownLanguage, popoutTitle } from '../src/popout-presentation';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';

function title(text: string, language: string): string {
  const dom = new JSDOM('');
  try {
    const rendered = dom.window.document.createElement('div');
    const renderer = createSafeMarkdownRenderer(dom.window as unknown as Window);
    rendered.innerHTML = isMarkdownLanguage(language) ? renderer.render(text) : renderer.renderCode(text, language);
    return popoutTitle(text, language, rendered);
  } finally { dom.window.close(); }
}

test('Markdown pop-out titles use the first rendered heading with plain inline text', () => {
  assert.equal(title('intro\n\n## **Plan** for [Nimrod](https://example.com) &amp; `Pi`\n\n# Later', 'MD'), 'Plan for Nimrod & Pi');
  assert.equal(title('Reference\n=========\n', 'mkdown'), 'Reference');
  assert.equal(title('```md\n# Not a document heading\n```\n\n## Actual heading', 'markdown'), 'Actual heading');
  assert.equal(title('#\n\n# Useful', 'mkd'), 'Useful');
});

test('code titles use the first nonempty line; empty content and heading-free Markdown use language names', () => {
  assert.equal(title('\n \n  const value = 1;\nnext line', 'ts'), 'const value = 1;');
  assert.equal(title('\n\0\nuseful\n', 'text'), 'useful');
  assert.equal(title('paragraph without a heading', 'markdown'), 'Markdown');
  assert.equal(title(' \n\t', 'ts'), 'TypeScript');
  assert.equal(title('', 'JSON'), 'JSON');
  assert.equal(title('', ''), 'Plain text');
  assert.equal(title('', 'custom'), 'custom');
});

test('titles are bounded, single-line and truncate Unicode without splitting code points', () => {
  const result = title('# ' + '🚀'.repeat(100), 'markdown');
  assert.equal(Array.from(result).length, 80);
  assert.equal(result, '🚀'.repeat(79) + '…');
  assert.equal(title('# a\tb', 'md'), 'a b');
  assert.equal(title('a\0b', 'text'), 'a b');
  assert.equal(title('x'.repeat(10_000), 'text'), 'x'.repeat(79) + '…');
});
