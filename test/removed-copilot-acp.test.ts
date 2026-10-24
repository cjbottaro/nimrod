import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readSavedSidebarSession } from '../src/session-lifecycle';
import { createBundledHarnessRegistry } from '../src/bundled-harnesses';
import { harnessHostFixture } from './harness-fixture';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';

test('removed Copilot ACP identities cannot restore or alias SDK sessions', () => {
  const legacy = { kind: 'acp', profile: 'copilot', sessionId: 'same-id', name: 'Old Copilot', lastUsed: 100 };
  const f = harnessHostFixture();
  assert.throws(() => createBundledHarnessRegistry(f.project).forReference(readSavedSidebarSession(legacy)!), /no registered harness/);
  f.dom.window.close();
  assert.deepEqual(readSavedSidebarSession({ ...legacy, kind: 'copilot-sdk' }), {
    kind: 'copilot-sdk', sessionId: 'same-id', name: 'Old Copilot', lastUsed: 100,
  });
});

test('Copilot cards belong only to the SDK; custom ACP agents keep the generic fallback', () => {
  const catalog = new CardPluginCatalog();
  const tool = { kind: 'execute', arguments: { command: 'fixture only' } };
  assert.equal(catalog.select({ ...tool, source: { backend: 'copilot-sdk', agent: 'copilot' } }).id, 'nimrod.copilot.shell');
  assert.equal(catalog.select({ ...tool, source: { backend: 'acp', agent: 'copilot' } }).id, 'nimrod.acp.tool');
});
