import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CardPluginCatalog, type PersonalBundles } from '../src/pi/card-plugins/catalog';
import { personalRenderer } from '../src/pi/card-plugins/executable';
import { readPluginSettings } from '../src/pi/card-plugins/declarative';
import { installCardPluginLoading } from '../src/card-plugin-loading';
import example from '../examples/card-plugins/command-summary/plugin';
import { renderToolCard } from '../src/pi/tool-card';
const bundle = (entry = 'command.ts', cacheHit = true): PersonalBundles => ({ entries: [entry], plugins: [{ entry, source: 'fixture', cacheHit }], warnings: [] });

test('personal modules supply matching metadata with no manifest or per-file trust settings', async () => {
  assert.equal(personalRenderer({ default: example }).renderer.id, example.id);
  assert.throws(() => personalRenderer({ default: { ...example, tools: undefined } }), /matching/);
  assert.throws(() => personalRenderer({ default: { ...example, id: 'nimrod.tool' } }), /reserved/);
  const catalog = new CardPluginCatalog();
  const report = await catalog.reload(readPluginSettings({}), async () => { throw new Error('No manifest should be read'); }, error => assert.equal(error, ''), {
    readModule: async () => { throw new Error('No legacy code read'); }, loadPersonal: async () => bundle(), importModule: async () => ({ default: example }),
  });
  assert.deepEqual(report, { personalLoaded: 1, cacheHits: 1, manifestLoaded: 0 }); assert.equal(catalog.select({ name: 'functions.bash' }).id, example.id);
});

test('disable avoids discovery/evaluation and stops managed instances; removal on reload disposes to raw recovery', async () => {
  const catalog = new CardPluginCatalog(); let scans = 0; let modules = 0;
  const host = { readModule: async () => '', loadPersonal: async () => { scans++; return bundle(); }, importModule: async () => { modules++; return { default: example }; } };
  await catalog.reload({ files: [], overrides: {}, autoLoad: false }, async () => '', () => {}, host); assert.deepEqual([scans, modules], [0, 0]);
  await catalog.reload({ files: [], overrides: {} }, async () => '', () => {}, host);
  const renderer = catalog.select({ name: 'bash' });
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  const card = renderToolCard(doc, { name: 'bash', arguments: { command: 'fixture' }, resultOutput: 'saved' }, doc.createElement('details'), renderer); doc.body.append(card);
  await catalog.reload({ files: [], overrides: {}, autoLoad: false }, async () => '', () => {}, host);
  assert.equal(renderer.supports({ name: 'bash' }), false);
  await catalog.reload({ files: [], overrides: {} }, async () => '', () => {}, { ...host, loadPersonal: async () => ({ entries: [], plugins: [], warnings: [] }) });
  assert.equal(renderer.supports({ name: 'bash' }), false); assert.deepEqual([scans, modules], [1, 1]); dom.window.close();
});

test('explicit manifest precedence is retained and duplicate personal IDs are reported after evaluation', async () => {
  const catalog = new CardPluginCatalog(); let errors = '';
  const text = JSON.stringify({ apiVersion: 1, id: example.id, tools: ['bash'], preview: 'Legacy priority', sections: [] });
  const report = await catalog.reload({ files: ['legacy.json'], overrides: {} }, async () => text, value => { errors = value; }, {
    readModule: async () => '', loadPersonal: async () => bundle(), importModule: async () => ({ default: example }),
  });
  assert.match(errors, /Duplicate/); assert.equal(report?.manifestLoaded, 1); assert.equal(report?.personalLoaded, 0);
  const dom = new JSDOM('<body></body>'); const card = renderToolCard(dom.window.document, { name: 'bash' }, dom.window.document.createElement('details'), catalog.select({ name: 'bash' }));
  assert.equal(card.querySelector('.tool-card-preview')?.textContent, 'Legacy priority'); dom.window.close();
});

test('source compile/import/metadata errors remain isolated and stale discovery cannot evaluate code', async () => {
  const catalog = new CardPluginCatalog(); let finish!: (value: PersonalBundles) => void; let evaluated = 0; let errors = '';
  const old = catalog.reload({ files: [], overrides: {} }, async () => '', () => {}, { readModule: async () => '', loadPersonal: () => new Promise(resolve => { finish = resolve; }), importModule: async () => { evaluated++; return { default: example }; } });
  await catalog.reload({ files: [], overrides: {}, autoLoad: false }, async () => '', () => {});
  finish(bundle()); await old; assert.equal(evaluated, 0);
  await catalog.reload({ files: [], overrides: {} }, async () => '', message => { errors = message; }, { readModule: async () => '', loadPersonal: async () => ({ ...bundle(), warnings: ['bad.ts: compile failed'] }), importModule: async () => ({ default: {} }) });
  assert.match(errors, /compile failed/); assert.match(errors, /Unsupported/); assert.equal(catalog.select({ name: 'bash' }).id, 'nimrod.tool');
});

test('background loader coalesces same-signature work, forces source reload and suppresses stale/unloaded reporting', async () => {
  const catalog = new CardPluginCatalog(); let finish!: (value: PersonalBundles) => void; let scans = 0; let completed = 0;
  let config = readPluginSettings({});
  const loading = installCardPluginLoading(catalog, {
    config: () => config, read: async () => '', executable: { readModule: async () => '', loadPersonal: () => { scans++; return new Promise(resolve => { finish = resolve; }); }, importModule: async () => ({ default: example }) },
    loading() {}, complete() { completed++; },
  });
  const first = loading.reload(); assert.equal(loading.reload(true), first); assert.equal(scans, 1);
  finish(bundle()); await first; await loading.reload(); assert.equal(scans, 1); assert.equal(completed, 1);
  const next = loading.reload(true); assert.equal(scans, 2);
  config = readPluginSettings({ 'cards.autoLoad': false }); await loading.reload(); assert.equal(completed, 2);
  finish(bundle()); await next; assert.equal(completed, 2);
  loading.dispose(); await loading.reload(true); assert.equal(scans, 2);
});
