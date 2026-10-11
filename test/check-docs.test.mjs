import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { marked } from 'marked';
import { checkFiles, headingIds } from '../scripts/check-docs.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'nimrod-doc-links-'));
  try {
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs/target.md'), '# Hello **World**!\n\n## Hello World\n\n## 日本語\n\n<a id="explicit"></a>\n');
    await writeFile(join(root, 'asset.txt'), 'fixture');
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('heading IDs include formatting, Unicode and duplicate suffixes, not fenced examples', () => {
  const ids = headingIds(marked.lexer('# Hello **World**!\n\n## Hello World\n\n## 日本語\n\n```md\n# Not a heading\n```'));
  assert.deepEqual([...ids], ['hello-world', 'hello-world-1', '日本語']);
});

test('local inline/reference/image/HTML links and heading anchors work offline', async () => {
  await fixture(async root => {
    await writeFile(join(root, 'README.md'), [
      '# Home', '',
      '[Inline](docs/target.md#hello-world)',
      '[Duplicate](docs/target.md#hello-world-1)',
      '[Unicode](docs/target.md#%E6%97%A5%E6%9C%AC%E8%AA%9E)',
      '[Explicit](docs/target.md#explicit)',
      '[Self](#home)',
      '[Reference][target]',
      '![Image](asset.txt)',
      '<a href="docs/target.md#hello-world">HTML</a>',
      '[External](https://example.invalid/not-fetched)',
      '[Mail](mailto:example@example.invalid)', '',
      '[target]: docs/target.md', '',
    ].join('\n'));
    assert.deepEqual(await checkFiles(['README.md'], root), []);
  });
});

test('missing files/anchors, invalid escapes and repository escapes fail; fenced examples are ignored', async () => {
  await fixture(async root => {
    await writeFile(join(root, 'README.md'), [
      '[Missing](absent.md)',
      '[Bad anchor](docs/target.md#absent)',
      '[Escape](../outside.md)',
      '[Invalid URL](bad%ZZ.md)',
      '[Fenced anchor](#fake-anchor)', '',
      '```md', '[Example](also-absent.md)', '<a id="fake-anchor"></a>', '```', '',
    ].join('\n'));
    const errors = await checkFiles(['README.md'], root);
    assert.equal(errors.length, 5);
    assert.ok(errors.some(error => error.includes('missing heading/anchor')));
    assert.ok(errors.some(error => error.includes('outside the repository')));
    assert.ok(!errors.some(error => error.includes('also-absent')));
  });
});
