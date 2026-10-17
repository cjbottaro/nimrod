import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { pluginTargets, matchesTarget, pluginKinds } from '../src/card-plugin-targets';
import { defineKindPlugin, rawToolPresentation } from '../src/card-plugin-ui';
import { personalRenderer } from '../src/pi/card-plugins/executable';
import type { CardPlugin, ToolCardData } from '../src/card-plugin-api';

const data: ToolCardData = { source: { backend: 'acp', agent: 'fixture-agent' }, kind: 'execute', name: 'run_shell', title: 'Run command', arguments: { command: 'printf fixture' }, toolStatus: 'result', resultOutput: '\x1b[32mfixture\x1b[0m' };
test('ACP tool selection cannot accidentally select a Pi Bash or legacy external plugin', async () => {
  const catalog = new CardPluginCatalog();
  assert.equal(catalog.select({ name: 'bash' }).id, 'nimrod.bash');
  assert.equal(catalog.select({ ...data, name: 'bash' }).id, 'nimrod.acp.tool');
  assert.equal(catalog.select({ ...data, source: { backend: 'acp', agent: 'copilot' } }).id, 'nimrod.acp.copilot-shell');
  await catalog.reload({ files: [], trusted: [], overrides: { execute: 'nimrod.bash' } }, async () => '', () => {}, {
    readModule: async () => '', loadPersonal: async () => ({ entries: ['legacy.ts'], plugins: [{ entry: 'legacy.ts', source: 'legacy', cacheHit: false }], warnings: [] }),
    importModule: async () => ({ default: { apiVersion: 2, id: 'external.legacy', tools: ['execute'], supports: () => true, mount() { return { update() {}, dispose() {} }; } } }),
  });
  assert.equal(catalog.select(data).id, 'nimrod.acp.tool');
  assert.equal(catalog.select({ name: 'execute' }).id, 'nimrod.bash', 'existing explicit Pi overrides retain their old behavior');
});

test('external ACP shell example bundles and mounts with the same public component as bundled cards', async () => {
  const bundle = await build({ entryPoints: ['examples/card-plugins/acp-shell/plugin.ts'], bundle: true, platform: 'browser', format: 'esm', write: false });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as { default: CardPlugin };
  const catalog = new CardPluginCatalog();
  await catalog.reload({ files: [], trusted: [], overrides: {} }, async () => '', () => {}, {
    readModule: async () => '', loadPersonal: async () => ({ entries: ['shell.ts'], plugins: [{ entry: 'shell.ts', source: 'external', cacheHit: false }], warnings: [] }), importModule: async () => module,
  });
  assert.equal(catalog.select(data).id, 'example.acp-shell');
  assert.notEqual(catalog.select({ name: 'execute' }).id, 'example.acp-shell');
  const dom = new JSDOM('<body></body>');
  try {
    const doc = dom.window.document;
    const details = renderToolCard(doc, data, doc.createElement('details'), catalog.select(data)); doc.body.append(details);
    assert.equal(details.querySelector('.tool-card-title')?.textContent, 'Run command');
    assert.equal(details.querySelector('.tool-card-preview')?.textContent, 'printf fixture');
    assert.equal(details.querySelector('.card-plugin-body .tool-output')?.textContent, 'fixture');
    assert.ok(details.querySelector('.tool-raw-output'), 'formatted output retains exact source outside the plugin');
    disposeToolCard(details);
  } finally { dom.window.close(); }
});

test('plugin target metadata is explicit and Pi/Copilot shell entries import only the public surface', () => {
  assert.deepEqual(pluginTargets(undefined), [{ backend: 'pi' }]);
  assert.equal(matchesTarget([{ backend: 'acp', agent: 'copilot' }], data), false);
  assert.equal(matchesTarget([{ backend: 'acp' }], data), true);
  assert.throws(() => pluginTargets([{ backend: 'bogus' }]));
  assert.throws(() => pluginKinds(['execute', 'execute']));
  for (const path of ['src/pi/card-plugins/bash.ts', 'src/acp/card-plugins.ts', 'examples/card-plugins/acp-shell/plugin.ts']) {
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(imports.every(path => /\/card-plugin-(?:api|ui)$/.test(path)), `${path} must not use private rendering imports`);
  }
});

async function catalogWith(plugins: CardPlugin[]) {
  const catalog = new CardPluginCatalog(), errors: string[] = [];
  await catalog.reload({ files: [], trusted: [], overrides: {} }, async () => '', message => { if (message) errors.push(message); }, {
    readModule: async () => '',
    loadPersonal: async () => ({ entries: plugins.map(plugin => plugin.id), plugins: plugins.map(plugin => ({ entry: plugin.id, source: plugin.id, cacheHit: false })), warnings: [] }),
    importModule: async source => ({ default: plugins.find(plugin => plugin.id === source) }),
  });
  assert.deepEqual(errors, []);
  return catalog;
}

test('ACP plugin selection distinguishes names from kinds and ranks exact agent targets first', async () => {
  const generic = defineKindPlugin('fixture.generic', ['execute'], rawToolPresentation);
  const specific = Object.assign(defineKindPlugin('fixture.specific', ['execute'], rawToolPresentation), { targets: [{ backend: 'acp' as const, agent: 'fixture-agent' }] });
  const named: CardPlugin = { ...specific, id: 'fixture.named', kinds: undefined, tools: ['run_shell'] };
  const catalog = await catalogWith([generic, specific, named]);
  assert.equal(catalog.select(data).id, 'fixture.named');
  assert.equal(catalog.select({ ...data, name: 'another_tool' }).id, 'fixture.specific');
  assert.equal(catalog.select({ ...data, name: undefined, source: { backend: 'acp', agent: 'unknown' } }).id, 'fixture.generic');
  assert.equal(catalog.select({ ...data, kind: 'other', name: 'execute' }).id, 'nimrod.acp.tool', 'a tool named execute is not necessarily an execute-category tool');
  assert.equal(catalog.select({ name: 'bash' }).id, 'nimrod.bash');
});

test('mount-time applicability can decline a category match without hiding another plugin', async () => {
  const base = defineKindPlugin('fixture.base', ['other'], rawToolPresentation);
  let firstMatches = 0;
  const first: CardPlugin = { ...base, id: 'fixture.first', matches: value => { firstMatches++; return value.name === 'first_tool'; } };
  const broken: CardPlugin = { ...base, id: 'fixture.broken', matches(value) { assert.equal(Object.isFrozen(value), true); throw new Error('isolated matcher fault'); } };
  const second: CardPlugin = { ...base, id: 'fixture.second', matches: value => value.name === 'second_tool' };
  const fallback = { ...base, id: 'fixture.fallback' };
  const catalog = await catalogWith([first, broken, second, fallback]);
  assert.equal(catalog.select({ ...data, kind: 'other', name: 'second_tool' }).id, 'fixture.second');
  assert.equal(catalog.select({ ...data, kind: 'other', name: 'unknown' }).id, 'fixture.fallback');
  const initial = { ...data, kind: 'other', name: 'first_tool' };
  const selected = catalog.select(initial);
  assert.equal(selected.id, 'fixture.first');
  const matches = firstMatches;
  const dom = new JSDOM();
  try {
    const doc = dom.window.document;
    const card = renderToolCard(doc, initial, doc.createElement('details'), selected); doc.body.append(card);
    const body = card.querySelector('.card-plugin-body');
    updateToolCard(doc, card, { ...initial, name: 'second_tool', resultOutput: 'later metadata' });
    assert.equal(card.querySelector('.card-plugin-body'), body);
    assert.equal(firstMatches, matches, 'mounted updates do not re-evaluate applicability or swap plugins');
    disposeToolCard(card);
  } finally { dom.window.close(); }
  assert.throws(() => personalRenderer({ default: { ...base, targets: undefined } }), /ACP target/);
});

test('invalid asynchronous applicability is declined and its rejection is consumed', async () => {
  const base = defineKindPlugin('fixture.base', ['execute'], rawToolPresentation);
  const asynchronous: CardPlugin = { ...base, id: 'fixture.async', matches: (() => Promise.reject(new Error('invalid async matcher'))) as unknown as CardPlugin['matches'] };
  const fallback = { ...base, id: 'fixture.fallback' };
  const catalog = await catalogWith([asynchronous, fallback]);
  assert.equal(catalog.select(data).id, 'fixture.fallback');
  await Promise.resolve();
});
