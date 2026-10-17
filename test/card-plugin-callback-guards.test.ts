import assert from 'node:assert/strict';
import test from 'node:test';
import { CardPluginCatalog, type ExecutablePluginHost } from '../src/pi/card-plugins/catalog';
import type { CardPlugin, ToolCardData } from '../src/card-plugin-api';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const data: ToolCardData = { source: { backend: 'acp', agent: 'fixture' }, name: 'run_shell', kind: 'execute' };
const manifest = JSON.stringify({ apiVersion: 2, id: 'fixture.guarded', tools: ['run_shell'], entry: 'plugin.js' });

async function fixture(personal: boolean) {
  const calls = { matches: 0, supports: 0 };
  const plugin: CardPlugin = {
    apiVersion: 2, id: 'fixture.guarded', tools: ['run_shell'], targets: [{ backend: 'acp' }],
    matches() { calls.matches++; return true; }, supports() { calls.supports++; return true; },
    mount() { return { update() {}, dispose() {} }; },
  };
  const catalog = new CardPluginCatalog();
  const config = { files: personal ? [] : ['fixture.json'], trusted: personal ? [] : ['fixture.json'], overrides: {}, autoLoad: true };
  const host: ExecutablePluginHost = {
    readModule: async () => 'fixture', importModule: async () => ({ default: plugin }),
    ...(personal ? { loadPersonal: async () => ({ entries: ['fixture.ts'], plugins: [{ entry: 'fixture.ts', source: 'fixture', cacheHit: false }], warnings: [] }) } : {}),
  };
  await catalog.reload(config, async () => manifest, message => assert.equal(message, ''), host);
  const retained = catalog.select(data);
  assert.equal(retained.id, plugin.id);
  assert.equal(retained.supports(data), true);
  assert.deepEqual(calls, { matches: 1, supports: 1 });
  return { catalog, calls, retained, config, host, plugin };
}

for (const change of ['revoke trust', 'disable manifest', 'disable personal sources'] as const) {
  test(`applicability respects ${change} while a replacement catalog read is suspended`, async () => {
    const f = await fixture(change === 'disable personal sources');
    const gate = deferred(), entered = deferred();
    const config = change === 'revoke trust' ? { ...f.config, trusted: [] }
      : change === 'disable manifest' ? { ...f.config, files: ['blocker.json'] }
      : { ...f.config, autoLoad: false, files: ['blocker.json'] };
    const reload = f.catalog.reload(config, async () => { entered.resolve(); await gate.promise; return manifest; }, () => {}, f.host);
    try {
      await entered.promise;
      assert.equal(f.catalog.select(data).id, 'nimrod.acp.tool', 'revoked retained entries cannot claim newly arriving cards');
      assert.equal(f.retained.supports(data), false, 'mounted compatibility uses the same current-permission guard');
      assert.deepEqual(f.calls, { matches: 1, supports: 1 }, 'neither callback may execute during revocation');
    } finally { gate.resolve(); await reload; f.catalog.dispose(); }
  });
}

test('removed personal sources cannot match while a newly discovered module import is suspended', async () => {
  const f = await fixture(true);
  const gate = deferred(), entered = deferred();
  const reload = f.catalog.reload(f.config, async () => manifest, () => {}, {
    ...f.host,
    loadPersonal: async () => ({ entries: ['replacement.ts'], plugins: [{ entry: 'replacement.ts', source: 'replacement', cacheHit: false }], warnings: [] }),
    importModule: async () => { entered.resolve(); await gate.promise; return { default: { ...f.plugin, id: 'fixture.replacement' } }; },
  });
  try {
    await entered.promise;
    assert.equal(f.catalog.select(data).id, 'nimrod.acp.tool');
    assert.equal(f.retained.supports(data), false);
    assert.deepEqual(f.calls, { matches: 1, supports: 1 });
  } finally { gate.resolve(); await reload; f.catalog.dispose(); }
});
