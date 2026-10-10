import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';

const elixir = 'defmodule Example do\n  def hello(name), do: {:ok, "Hello #{name}"}\nend\n';

function withRenderer(run: (renderer: ReturnType<typeof createSafeMarkdownRenderer>, document: Document) => void): void {
  const dom = new JSDOM('');
  try {
    run(createSafeMarkdownRenderer(dom.window as unknown as Window), dom.window.document);
  } finally { dom.window.close(); }
}

for (const language of ['elixir', 'ex', 'exs', 'ELIXIR']) {
  test(`Elixir highlighting supports ${language} in Markdown and code snapshots`, () => withRenderer((renderer, document) => {
    for (const html of [renderer.render(`\`\`\`${language}\n${elixir}\`\`\``), renderer.renderCode(elixir, language)]) {
      document.body.innerHTML = html;
      assert.equal(document.querySelector('pre > code')!.textContent, elixir);
      assert.equal(document.querySelector('.code-language')!.textContent, language);
      assert.ok(document.querySelector('.hljs-keyword'));
      assert.ok(document.querySelector('.hljs-string'));
    }
  }));
}

test('Erlang and existing common-language aliases still highlight', () => withRenderer((renderer, document) => {
  for (const [language, source] of [['erlang', '-module(example).\nhello() -> ok.\n'], ['erl', '-module(example).\n'], ['ts', 'const value: string = "hello";\n'], ['JS', 'const value = "hello";\n']]) {
    document.body.innerHTML = renderer.render(`\`\`\`${language}\n${source}\`\`\``);
    assert.equal(document.querySelector('pre > code')!.textContent, source);
    assert.ok(document.querySelector('code span'), language);
  }
  document.body.innerHTML = renderer.renderCode(elixir, ' ELIXIR ');
  assert.ok(document.querySelector('.hljs-keyword'));
  assert.equal(document.querySelector('.code-language')!.textContent, 'ELIXIR');
}));

test('unlabeled, plain-text and unknown-language blocks never guess from their contents', () => withRenderer((renderer, document) => {
  for (const source of [elixir, 'const value = "hello";\n', '2026-01-01 INFO: started\n', '<script>alert(1)</script>\n']) {
    for (const language of ['', 'text', 'plaintext', 'unknown-language']) {
      for (const html of [renderer.render(`\`\`\`${language}\n${source}\`\`\``), renderer.renderCode(source, language)]) {
        document.body.innerHTML = html;
        assert.equal(document.querySelector('pre > code')!.textContent, source);
        assert.equal(document.querySelector('code span'), null);
        assert.equal(document.querySelector('script'), null);
        assert.equal(document.querySelector('.code-language')!.textContent, language || 'plain text');
        assert.doesNotMatch(html, /\(detected\)/);
      }
    }
  }
  document.body.innerHTML = renderer.render('    const value = "hello";\n');
  assert.equal(document.querySelector('code span'), null);
  assert.equal(document.querySelector('.code-language')!.textContent, 'plain text');
}));

const python = 'def hello(name):\n    print("Hello", name)\n    return None\n';

test('opted-in user code detects a strong winner, including indented code', () => withRenderer((renderer, document) => {
  for (const markdown of [`\`\`\`\n${python}\`\`\``, python.split('\n').map(line => `    ${line}`).join('\n')]) {
    document.body.innerHTML = renderer.render(markdown, { detectUnlabeledCode: true });
    assert.equal(document.querySelector('.code-language')!.textContent, 'python (detected)');
    assert.ok(document.querySelector('.hljs-keyword'));
  }
}));

test('user detection rejects weak, tied and closely competing guesses', () => withRenderer((renderer, document) => {
  for (const source of [
    'const value = "hello";\n', // relevance 2, previously accepted
    'def hello(name):\n    print(name)\n', // winner below 6
    elixir, // Ruby/Elixir tie: do not confidently mislabel as Ruby
    'SELECT users.id, users.name\nFROM users\nWHERE users.active = true\nORDER BY users.name;\n', // 6 vs 5
    '2026-01-01 INFO: started\n',
    'The quick brown fox jumps over the lazy dog.\n',
  ]) {
    document.body.innerHTML = renderer.render(`\`\`\`\n${source}\`\`\``, { detectUnlabeledCode: true });
    assert.equal(document.querySelector('.code-language')!.textContent, 'plain text', source);
    assert.equal(document.querySelector('code span'), null);
    assert.equal(document.querySelector('pre > code')!.textContent, source);
  }
}));

test('explicit user labels always win, including plain text and unsupported labels', () => withRenderer((renderer, document) => {
  for (const language of ['text', 'plaintext', 'unknown-language', 'python']) {
    document.body.innerHTML = renderer.render(`\`\`\`${language}\n${python}\`\`\``, { detectUnlabeledCode: true });
    assert.equal(document.querySelector('.code-language')!.textContent, language);
    assert.equal(!!document.querySelector('code span'), language === 'python');
  }
  document.body.innerHTML = renderer.render(`\`\`\`exs\n${elixir}\`\`\``, { detectUnlabeledCode: true });
  assert.equal(document.querySelector('.code-language')!.textContent, 'exs');
  assert.ok(document.querySelector('.hljs-keyword'));
}));

test('highlighting keeps source and code actions safe', () => withRenderer((renderer, document) => {
  const source = 'def hello, do: "<script>alert(1)</script><img src=x onerror=alert(1)>"\n';
  for (const html of [renderer.render(`\`\`\`elixir\n${source}\`\`\``), renderer.renderCode(source, 'exs')]) {
    document.body.innerHTML = html;
    assert.equal(document.querySelector('pre > code')!.textContent, source);
    assert.equal(document.querySelector('script, img, [onerror]'), null);
    assert.ok(document.querySelector('.hljs-string'));
    assert.equal(document.querySelectorAll('.code-copy').length, 1);
  }
  document.body.innerHTML = renderer.renderCode(source, 'elixir');
  assert.equal(document.querySelector('.code-popout'), null);
}));
