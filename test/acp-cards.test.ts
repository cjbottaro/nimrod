import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { renderToolCard, disposeToolCard } from '../src/pi/tool-card';
import { pluginTargets, matchesTarget } from '../src/card-plugin-targets';
import type { CardPlugin, ToolCardData } from '../src/card-plugin-api';

const data: ToolCardData = { source: { backend: 'acp', agent: 'fixture-agent' }, kind: 'execute', name: 'execute', title: 'Run command', arguments: { command: 'printf fixture' }, toolStatus: 'result', resultOutput: '\x1b[32mfixture\x1b[0m' };
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
  for (const path of ['src/pi/card-plugins/bash.ts', 'src/acp/card-plugins.ts', 'examples/card-plugins/acp-shell/plugin.ts']) {
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(imports.every(path => /\/card-plugin-(?:api|ui)$/.test(path)), `${path} must not use private rendering imports`);
  }
});
