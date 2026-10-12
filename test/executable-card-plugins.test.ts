import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { parseExecutableManifest, executableRenderer, importCardModule } from '../src/pi/card-plugins/executable';
import { readPluginSettings } from '../src/pi/card-plugins/declarative';
import { renderToolCard, updateToolCard, type ToolCardBlock } from '../src/pi/tool-card';
import type { DomCardRenderer } from '../src/pi/dom-card-renderer';
import example from '../examples/card-plugins/command-summary/plugin';

const manifest = JSON.stringify({ apiVersion: 2, id: 'example.command-summary', tools: ['bash'], entry: 'plugin.js' });
const settings = { files: ['plugin.json'], overrides: {}, trusted: ['plugin.json'] };

test('executable manifest/exports require versioned local entry, matching identity and valid renderer shape', () => {
  const parsed = JSON.parse(manifest);
  for (const entry of ['../plugin.js', '/tmp/plugin.js', 'https://example.com/a.js', 'source.ts']) assert.throws(() => parseExecutableManifest(JSON.stringify({ ...parsed, entry })));
  for (const bad of [{ ...parsed, apiVersion: 3 }, { ...parsed, id: 'nimrod.tool' }, { ...parsed, tools: [] }, { ...parsed, css: 'body{}' }]) assert.throws(() => parseExecutableManifest(JSON.stringify(bad)));
  assert.equal(executableRenderer(parseExecutableManifest(manifest), { default: example }), example);
  for (const bad of [{}, { default: {} }, { default: { ...example, apiVersion: 1 } }, { default: { ...example, id: 'example.other' } }]) assert.throws(() => executableRenderer(parseExecutableManifest(manifest), bad));
  assert.throws(() => readPluginSettings({ 'cards.trustedPlugins': ['../plugin.json'] }));
  assert.throws(() => readPluginSettings({ 'cards.trustedPlugins': true }));
});

test('untrusted packages are never read as code or evaluated, and duplicate IDs do not execute later entries', async () => {
  const catalog = new CardPluginCatalog(); let reads = 0; let evaluations = 0; let errors = '';
  const host = { readModule: async () => { reads++; return 'fixture'; }, importModule: async () => { evaluations++; return { default: example }; } };
  await catalog.reload({ ...settings, trusted: [] }, async () => manifest, message => { errors = message; }, host);
  assert.deepEqual([reads, evaluations], [0, 0]); assert.match(errors, /explicit/);
  await catalog.reload({ ...settings, files: ['plugin.json', 'duplicate.json'], trusted: ['plugin.json', 'duplicate.json'] }, async () => manifest, message => { errors = message; }, host);
  assert.deepEqual([reads, evaluations], [1, 1]); assert.match(errors, /Duplicate/);
});

test('public TypeScript example compiles without runtime SDK imports and retains custom DOM, state, raw recovery and host functionality', async () => {
  const output = await build({ entryPoints: ['examples/card-plugins/command-summary/plugin.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  assert.match(output.outputFiles[0].text, /export/); assert.doesNotMatch(output.outputFiles[0].text, /from.*card-plugin-api/);
  const catalog = new CardPluginCatalog();
  await catalog.reload(settings, async () => manifest, message => assert.equal(message, ''), { readModule: async () => output.outputFiles[0].text, importModule: async () => ({ default: example }) });
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; const copied: string[] = [];
  try {
    const data = { name: 'bash', arguments: { command: 'pwd' }, toolStatus: 'running' as const, executionOutput: 'one' };
    const card = renderToolCard(doc, data, doc.createElement('details'), catalog.select(data), undefined, { copy: async text => { copied.push(text); } }); doc.body.append(card);
    const note = card.querySelector<HTMLInputElement>('input')!; note.value = 'local note'; note.focus();
    updateToolCard(doc, card, { ...data, executionOutput: 'two' });
    assert.equal(card.querySelector('input'), note); assert.equal(note.value, 'local note'); assert.equal(doc.activeElement, note);
    assert.match(card.querySelector('.tool-raw-output')?.textContent || '', /two/);
    card.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(copied, ['pwd']);
    await catalog.reload({ files: [], overrides: { bash: 'example.command-summary' }, trusted: [] }, async () => '', () => {});
    card.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve();
    assert.equal(copied.length, 1); assert.equal(card.querySelector('input'), null); assert.match(card.textContent || '', /two/);
  } finally { dom.window.close(); }
});

test('module import/identity failure reports Settings errors and preserves historical raw fallback', async () => {
  const catalog = new CardPluginCatalog(); let errors = '';
  await catalog.reload({ ...settings, overrides: { bash: 'example.command-summary' } }, async () => manifest, message => { errors = message; }, { readModule: async () => 'fixture', importModule: async () => { throw new Error('module failed'); } });
  assert.match(errors, /module failed/);
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  const data = { name: 'bash', resultOutput: 'saved result', toolStatus: 'result' as const };
  const card = renderToolCard(doc, data, doc.createElement('details'), catalog.select(data));
  assert.match(card.textContent || '', /saved result/); dom.window.close();
  await assert.rejects(importCardModule(' '.repeat(1024 * 1024 + 1)), /exceeds/);
});

test('stale reads cannot evaluate code or overwrite newer trust/configuration; disposal invalidates pending reads', async () => {
  const catalog = new CardPluginCatalog(); let finish!: (source: string) => void; let evaluated = 0;
  const pending = catalog.reload(settings, async () => manifest, () => {}, { readModule: () => new Promise(resolve => { finish = resolve; }), importModule: async () => { evaluated++; return { default: example }; } });
  await Promise.resolve(); await Promise.resolve();
  await catalog.reload({ files: [], overrides: {}, trusted: [] }, async () => '', () => {});
  finish('fixture'); await pending; assert.equal(evaluated, 0);
  const disposed = catalog.reload(settings, async () => manifest, () => {}, { readModule: () => new Promise(resolve => { finish = resolve; }), importModule: async () => { evaluated++; return { default: example }; } });
  await Promise.resolve(); await Promise.resolve(); catalog.dispose(); finish('fixture'); await disposed; assert.equal(evaluated, 0);
});

test('already-started imports cannot publish over a newer catalog', async () => {
  const catalog = new CardPluginCatalog(); let finish!: (value: unknown) => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const old = catalog.reload(settings, async () => manifest, () => {}, { readModule: async () => 'fixture', importModule: () => {
    began(); return new Promise(resolve => { finish = resolve; });
  } });
  await started; await catalog.reload({ files: [], overrides: { bash: 'nimrod.raw' }, trusted: [] }, async () => '', () => {});
  finish({ default: example }); await old; assert.equal(catalog.select({ name: 'bash' }).id, 'nimrod.raw');
});

test('plugin mutation cannot corrupt the retained tool data used by core raw recovery', async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.mutable', supports: () => true,
    mount: () => ({ update(data) { (data.arguments as Record<string, unknown>).command = 'corrupted'; }, dispose() {} }),
  };
  const data = { name: 'bash', arguments: { command: 'original' }, resultOutput: 'retained' };
  const card = renderToolCard(doc, data, doc.createElement('details'), plugin);
  assert.equal(data.arguments.command, 'original'); assert.match(card.querySelector('.tool-raw-inputs')?.textContent || '', /original/);
  assert.match(card.querySelector('.tool-output')?.textContent || '', /retained/); dom.window.close();
});

test('generic presentation helper keeps member nodes stable and prunes removed keys', async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  let members = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }];
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.members', supports: () => true,
    mount: ctx => ({ update() { ctx.renderPresentation({ title: 'Members', sections: [], members }); }, dispose() {} }),
  };
  const card = renderToolCard(doc, { name: 'fixture' }, doc.createElement('details'), plugin);
  const first = card.querySelector('[data-member-key="a"]');
  members = [{ key: 'a', title: 'Updated' }]; updateToolCard(doc, card, { name: 'fixture' });
  assert.equal(card.querySelector('[data-member-key="a"]'), first);
  assert.equal(first?.textContent, 'Updated'); assert.equal(card.querySelector('[data-member-key="b"]'), null); dom.window.close();
});

test('external DOM update failure disposes the instance and preserves latest raw results', async () => {
  let disposed = 0;
  const broken: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'example.command-summary', supports: () => true,
    mount: () => ({ update() { throw new Error('bad DOM'); }, dispose() { disposed++; } }),
  };
  const catalog = new CardPluginCatalog(); await catalog.reload(settings, async () => manifest, () => {}, { readModule: async () => '', importModule: async () => ({ default: broken }) });
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  const card = renderToolCard(doc, { name: 'bash', resultOutput: 'original' }, doc.createElement('details'), catalog.select({ name: 'bash' }));
  updateToolCard(doc, card, { name: 'bash', resultOutput: 'latest' }); assert.match(card.textContent || '', /latest/); assert.equal(disposed, 1); dom.window.close();
});
