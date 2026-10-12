import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { declarativeRenderer, parsePluginPackage, readPluginSettings } from '../src/pi/card-plugins/declarative';
import { parseSettings } from '../src/preferences';
import { captureStreamingOutput } from '../src/pi/card-shell';
import { renderToolCard, updateToolCard } from '../src/pi/tool-card';

const packageText = JSON.stringify({ apiVersion: 1, id: 'example.read', tools: ['read'], preview: '{{/arguments/path}}', sections: [{ key: 'path', label: 'Reading', template: '{{/arguments/path}}: {{/resultOutput}}' }] });

test('declarative packages reject incompatible versions, code/style/actions, unsafe pointers and duplicate keys', () => {
  const pkg = JSON.parse(packageText);
  for (const value of [
    { ...pkg, apiVersion: 2 }, { ...pkg, id: 'nimrod.tool' }, { ...pkg, script: 'execute()' }, { ...pkg, css: 'body {}' }, { ...pkg, actions: [] },
    { ...pkg, preview: '{{/__proto__/x}}' }, { ...pkg, preview: '{{/constructor}}' }, { ...pkg, preview: '{{/x~2}}' }, { ...pkg, preview: '{{bad}}' },
    { ...pkg, tools: ['read', 'read'] }, { ...pkg, sections: [pkg.sections[0], pkg.sections[0]] },
    { ...pkg, sections: [{ ...pkg.sections[0], format: 'html' }] }, { ...pkg, sections: [{ ...pkg.sections[0], format: 'markdown' }] },
  ]) assert.throws(() => parsePluginPackage(JSON.stringify(value)));
  assert.equal(parsePluginPackage(packageText).id, 'example.read');
  assert.throws(() => parsePluginPackage(' '.repeat(256 * 1024 + 1)));
});

test('oversized expanded templates fail to raw recovery rather than multiplying retained data', async () => {
  const pkg = parsePluginPackage(JSON.stringify({ apiVersion: 1, id: 'example.large', tools: ['read'], sections: [
    { key: 'repeat', label: 'Repeat', template: '{{/resultOutput}}{{/resultOutput}}{{/resultOutput}}' },
  ] }));
  assert.throws(() => declarativeRenderer(pkg).mount().update({ resultOutput: 'a'.repeat(1024 * 1024) }), /exceeds/);
});

test('settings accept only local package filenames and normalized tool overrides', () => {
  assert.deepEqual(readPluginSettings({}), { files: [], overrides: {}, trusted: [] });
  assert.deepEqual(parseSettings('{"cards.plugins":["read.json"],"cards.renderers":{"read":"example.read"}}')['cards.plugins'], ['read.json']);
  for (const files of [['../x.json'], ['/x.json'], ['x.js'], ['x.json', 'x.json']]) assert.throws(() => readPluginSettings({ 'cards.plugins': files }));
  assert.throws(() => readPluginSettings({ 'cards.renderers': { 'functions.read': 'example.read' } }));
});

test('external selection uses ordered matching and overrides, retaining raw historical results and mounted shells', async () => {
  const catalog = new CardPluginCatalog();
  await catalog.reload({ files: ['read.json'], overrides: {} }, async () => packageText, message => assert.equal(message, ''));
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const data = { name: 'functions.read', arguments: { path: '<img onerror=bad>' }, toolStatus: 'result' as const, resultOutput: 'saved result' };
    const renderer = catalog.select(data);
    assert.equal(renderer.id, 'example.read');
    const card = renderToolCard(doc, data, doc.createElement('details'), renderer); doc.body.append(card); card.open = true;
    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('[data-output-kind="plugin:path"] .tool-output')?.textContent, '<img onerror=bad>: saved result');
    assert.equal(card.querySelector('[data-output-kind="result"] .tool-output')?.textContent, 'saved result');
    await catalog.reload({ files: [], overrides: { read: 'example.missing' } }, async () => '', () => {});
    updateToolCard(doc, card, { ...data, resultOutput: 'updated' });
    assert.equal(card.open, true);
    assert.match(card.querySelector('[data-output-kind="plugin:path"] .tool-output')?.textContent || '', /updated/);
    const missing = renderToolCard(doc, data, doc.createElement('details'), catalog.select(data));
    assert.equal(missing.querySelector('[data-output-kind="plugin:path"]'), null);
    assert.equal(missing.querySelector('.tool-output')?.textContent, 'saved result');
  } finally { dom.window.close(); }
});

test('custom sections do not take ownership of raw live-output inspection', async () => {
  const catalog = new CardPluginCatalog();
  await catalog.reload({ files: ['read.json'], overrides: {} }, async () => packageText, () => {});
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const data = { name: 'read', arguments: { path: 'a' }, toolStatus: 'running' as const, executionOutput: 'progress' };
    const card = renderToolCard(doc, data, doc.createElement('details'), catalog.select(data));
    const custom = card.querySelector<HTMLElement>('[data-output-kind="plugin:path"] .tool-output')!;
    const raw = card.querySelector<HTMLElement>('[data-output-kind="result"] .tool-output')!;
    for (const output of [custom, raw]) Object.defineProperties(output, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
    custom.scrollTop = 11; raw.scrollTop = 71;
    assert.deepEqual(captureStreamingOutput(card), { top: 71, atBottom: false });
  } finally { dom.window.close(); }
});

test('bad/missing/duplicate packages report errors without blocking built-in fallback; stale loads cannot win', async () => {
  const catalog = new CardPluginCatalog(); let errors = '';
  await catalog.reload({ files: ['missing.json', 'bad.json', 'first.json', 'duplicate.json'], overrides: {} }, async name => {
    if (name === 'missing.json') throw new Error('missing');
    return name === 'bad.json' ? '{' : packageText;
  }, message => { errors = message; });
  assert.match(errors, /missing.json/); assert.match(errors, /bad.json/); assert.match(errors, /Duplicate/);
  assert.equal(catalog.select({ name: 'bash' }).id, 'nimrod.tool');
  assert.equal(catalog.select({ name: 'constructor' }).id, 'nimrod.tool');
  assert.equal(catalog.select({ name: 'toString' }).id, 'nimrod.tool');
  let resolve!: (text: string) => void;
  const old = catalog.reload({ files: ['read.json'], overrides: {} }, () => new Promise(done => { resolve = done; }), () => {});
  await catalog.reload({ files: [], overrides: { read: 'nimrod.raw' } }, async () => '', () => {});
  resolve(packageText); await old;
  assert.equal(catalog.select({ name: 'read' }).id, 'nimrod.raw');
});
