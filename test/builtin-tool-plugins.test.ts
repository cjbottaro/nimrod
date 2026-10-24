import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { bundledToolPlugins, bundledToolRenderer } from '../src/pi/card-plugins/registry';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { personalRenderer } from '../src/pi/card-plugins/executable';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { toolInputPreview } from '../src/pi/card-plugins/tool';
import { readPresentation } from '../src/pi/card-plugins/read';
import { writePresentation } from '../src/pi/card-plugins/write';

const cases = [
  { name: 'read', id: 'nimrod.read', arguments: { path: 'a.ts', offset: 2, limit: 3 }, preview: 'a.ts · lines 2–4' },
  { name: 'bash', id: 'nimrod.bash', arguments: { command: 'printf hello' }, preview: 'printf hello' },
  { name: 'edit', id: 'nimrod.edit-preview', arguments: { path: 'a.ts', oldText: 'old', newText: 'new' }, preview: 'a.ts' },
  { name: 'write', id: 'nimrod.write', arguments: { path: 'b.ts', content: 'requested' }, preview: 'b.ts' },
  { name: 'grep', id: 'nimrod.grep', arguments: { pattern: 'needle', path: 'src' }, preview: 'needle in src' },
  { name: 'find', id: 'nimrod.find', arguments: { pattern: '**/*.ts', path: 'src' }, preview: '**/*.ts in src' },
  { name: 'ls', id: 'nimrod.ls', arguments: { path: 'src' }, preview: 'src' },
];

test('each built-in selects its own API-v2 plugin by normalized metadata, not argument completeness', () => {
  assert.equal(bundledToolPlugins.length, 8);
  assert.equal(new Set(bundledToolPlugins.map(plugin => plugin.id)).size, 8);
  assert.equal(bundledToolRenderer({ name: 'functions.codemode' }).id, 'nimrod.codemode');
  for (const fixture of cases) {
    const plugin = bundledToolRenderer({ name: fixture.name });
    assert.equal(plugin.id, fixture.id);
    assert.equal(plugin.apiVersion, 2);
    assert.ok(plugin.tools?.includes(fixture.name));
    for (const name of [fixture.name, ` functions.${fixture.name.toUpperCase()} `, `pi/tools:${fixture.name}`]) {
      assert.equal(bundledToolRenderer({ name }), plugin);
      for (const args of [undefined, '', '{', {}, fixture.arguments]) assert.equal(plugin.supports({ name, arguments: args }), true);
    }
    assert.equal(plugin.supports({ name: 'unrelated' }), false);
    // Reserved bundled IDs aside, exports pass the actual personal plugin contract.
    const external = personalRenderer({ default: { ...plugin, id: `fixture.${fixture.name}` } });
    assert.deepEqual(external.tools, plugin.tools);
  }
  for (const name of ['shell', 'terminal', 'functions.bash']) assert.equal(bundledToolRenderer({ name }).id, 'nimrod.bash');
  for (const name of [undefined, 'custom', 'constructor', 'toString', '__proto__', 'read_extra']) {
    assert.equal(bundledToolRenderer({ name }).id, 'nimrod.tool');
  }
});

test('tool-owned previews agree with parallel overview previews and survive partial/malformed arguments', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    for (const fixture of cases) {
      const plugin = bundledToolRenderer(fixture);
      const card = renderToolCard(doc, { name: fixture.name }, doc.createElement('details'), plugin); doc.body.append(card);
      assert.equal(card.querySelector('.tool-card-preview'), null);
      for (const args of ['{', '[]', '{"nested":{"path":"not-top-level"}', '{"path":"unfinished']) {
        updateToolCard(doc, card, { name: fixture.name, arguments: args });
        assert.equal(card.querySelector('.tool-card-preview'), null, fixture.name);
      }
      const data = { ...fixture, toolStatus: 'result' as const, resultOutput: 'actual result' };
      updateToolCard(doc, card, data);
      assert.equal(card.querySelector('.tool-card-preview')?.textContent, fixture.preview);
      assert.equal(toolInputPreview(fixture.name, fixture.arguments), fixture.preview);
      assert.equal(card.querySelector('.tool-card-title')?.textContent, fixture.name);
      // Edit can intentionally omit the primary result, but core must keep it readable.
      assert.ok(Array.from(card.querySelectorAll('.tool-output')).some(node => node.textContent === 'actual result'));
      disposeToolCard(card);
    }
    const partial = renderToolCard(doc, { name: 'read', arguments: '{"path":"a.ts","offset":' }, doc.createElement('details'));
    assert.equal(partial.querySelector('.tool-card-preview')?.textContent, 'a.ts');
    disposeToolCard(partial);
  } finally { dom.window.close(); }
});

test('read range is requested input, validates integer bounds and leaves result bytes literal', () => {
  for (const [args, preview] of [
    [{ path: 'a', limit: 3 }, 'a · lines 1–3'],
    [{ path: 'a', offset: 5 }, 'a · from line 5'],
    [{ path: 'a', offset: 0, limit: 3 }, 'a'],
    [{ path: 'a', offset: -1, limit: 3 }, 'a'],
    [{ path: 'a', offset: 1.5, limit: 3 }, 'a'],
    [{ path: 'a', offset: '5', limit: 3 }, 'a'],
    [{ path: 'a', offset: 2, limit: 0 }, 'a'],
    [{ path: 'a', offset: Number.MAX_SAFE_INTEGER, limit: 3 }, `a · from line ${Number.MAX_SAFE_INTEGER}`],
  ] as const) {
    const value = readPresentation({ name: 'read', arguments: args, resultOutput: '\x1b[32m<literal>' });
    assert.equal(value.preview, preview);
    assert.equal(value.sections[0].text, '\x1b[32m<literal>');
    assert.equal(value.sections[0].format, undefined);
  }
});

test('write preview is input-backed, exact and safely literal, including empty content and errors', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    for (const content of ['', '<img src=x onerror=bad>\n\x1b[32mtext']) {
      const data: ToolCardData = { name: 'write', arguments: { path: '<destination>', content }, toolStatus: 'result', isError: true, resultOutput: 'permission denied' };
      const card = renderToolCard(doc, data, doc.createElement('details'));
      assert.equal(card.querySelector('[data-output-kind="requested-content"] .tool-label')?.textContent, 'Requested content');
      assert.equal(card.querySelector('[data-output-kind="requested-content"] .tool-output')?.textContent, content);
      assert.equal(card.querySelector('[data-output-kind="result"] .tool-output')?.textContent, 'permission denied');
      assert.equal(card.querySelector('img'), null);
      assert.match(card.querySelector('.tool-raw-inputs pre')?.textContent || '', /destination/);
      disposeToolCard(card);
    }
    for (const args of [undefined, {}, { content: 3 }, '{"content":"unfinished']) {
      assert.equal(writePresentation({ name: 'write', arguments: args }).sections.length, 0);
    }
  } finally { dom.window.close(); }
});

test('every tool retains independent mounted output, focus, disclosure and raw inputs through execution and completion', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    for (const fixture of cases) {
      // No edit substitutions here so all seven exercise their raw execution/result viewports.
      const args = fixture.name === 'edit' ? { path: 'a.ts' } : fixture.arguments;
      const data: ToolCardData = { name: fixture.name, arguments: args, toolStatus: 'running', executionOutput: 'first' };
      const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card); card.open = true;
      const sibling = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(sibling);
      const output = card.querySelector<HTMLElement>('[data-output-kind="result"] .tool-output')!;
      const raw = card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!; raw.open = true;
      const inputText = raw.querySelector('pre')!.firstChild;
      const text = output.firstChild; const spinner = card.querySelector('.tool-card-spinner');
      const descriptor = Object.getOwnPropertyDescriptor(doc.defaultView!.Node.prototype, 'textContent')!;
      // Edit intentionally customizes DOM, so it retains core's compatibility inspection.
      if (fixture.name !== 'edit') Object.defineProperty(output, 'textContent', {
        get() { throw new Error('pure tool adapter must not scan accumulated DOM text'); },
        set(value) { descriptor.set!.call(this, value); }, configurable: true,
      });
      Object.defineProperties(output, { clientHeight: { value: 40 }, scrollHeight: { value: 200 } });
      output.scrollTop = 30; output.focus();
      updateToolCard(doc, card, { ...data, executionOutput: 'first appended' });
      assert.equal(card.querySelector('.tool-card-spinner'), spinner);
      assert.equal(output.firstChild, text); assert.equal(text!.textContent, 'first appended');
      for (const phase of [
        { toolStatus: 'result' as const },
        { toolStatus: 'result' as const, uiPhase: 'thinking' as const },
        { toolStatus: 'result' as const, uiPhase: 'stopped' as const },
        { toolStatus: 'result' as const, isError: true },
      ]) {
        updateToolCard(doc, card, { ...data, ...phase, resultOutput: 'first appended done' });
        assert.equal(card.querySelector('[data-output-kind="result"] .tool-output'), output);
        assert.equal(output.scrollTop, 30); assert.equal(doc.activeElement, output);
        assert.equal(card.open, true); assert.equal(raw.open, true);
        assert.equal(raw.querySelector('pre')!.firstChild, inputText);
        assert.equal(sibling.querySelector('[data-output-kind="result"] .tool-output')?.textContent, 'first');
      }
      disposeToolCard(card); disposeToolCard(card); disposeToolCard(sibling);
      card.remove(); sibling.remove();
    }
  } finally { dom.window.close(); }
});

test('catalog honors external precedence, dedicated/generic/raw overrides and incompatible IDs', async () => {
  const catalog = new CardPluginCatalog();
  const pkg = JSON.stringify({ apiVersion: 1, id: 'example.read', tools: ['read'], sections: [] });
  await catalog.reload({ files: ['read.json'], overrides: {} }, async () => pkg, () => {});
  assert.equal(catalog.select({ name: 'functions.read' }).id, 'example.read');
  for (const fixture of cases) {
    await catalog.reload({ files: ['read.json'], overrides: { [fixture.name]: fixture.id } }, async () => pkg, () => {});
    assert.equal(catalog.select(fixture).id, fixture.id);
    for (const id of ['nimrod.tool', 'nimrod.raw']) {
      await catalog.reload({ files: [], overrides: { [fixture.name]: id } }, async () => '', () => {});
      assert.equal(catalog.select(fixture).id, id);
    }
  }
  await catalog.reload({ files: [], overrides: { read: 'nimrod.write' } }, async () => '', () => {});
  assert.equal(catalog.select({ name: 'read' }).supports({ name: 'read' }), false);
  catalog.dispose();
});
