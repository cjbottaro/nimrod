import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnosticLog } from '../src/diagnostic-logs';
import { copilotDiagnosticMetadata } from '../copilot/diagnostics.mjs';
import { createCopilotConfiguration } from '../copilot/configuration.mjs';

const record = { source: { backend: 'copilot-sdk', agent: 'copilot' }, sessionId: 'fixture',
  connectionId: '11111111-1111-4111-8111-111111111111', event: 'model.snapshot', payload: {} };

test('diagnostic stream is opt-in, bounded shared transport with independent capture identity and no retry', async () => {
  const writes: string[][] = [], failures: string[] = [];
  const log = createDiagnosticLog({ write: async lines => { writes.push(lines); }, failure: message => failures.push(message), recovered() {} });
  try {
    log.append(record); await log.flush(); assert.equal(writes.length, 0);
    log.setEnabled(true); log.append(record); await log.flush();
    const first = JSON.parse(writes[0][0]);
    assert.equal(first.schemaVersion, 1); assert.equal(first.event, 'model.snapshot');
    assert.equal(first.connectionId, record.connectionId);
    log.writeFailed(first.captureId, 'fixture IO failure');
    assert.equal(log.enabled, false); assert.match(failures[0], /Toggle diagnostic logs/);
    log.append(record); await log.flush(); assert.equal(writes.length, 1);
    log.setEnabled(false); log.setEnabled(true); log.append(record); await log.flush();
    assert.notEqual(JSON.parse(writes[1][0]).captureId, first.captureId);
    log.writeFailed(first.captureId, 'stale failure'); assert.equal(log.enabled, true);
  } finally { log.dispose(); }
});

test('Copilot diagnostic allowlist preserves omission/null/zero and excludes conversations and credentials', () => {
  const model = copilotDiagnosticMetadata('model.snapshot', { raw: { modelId: 'fixture', contextTier: null, prompt: 'SECRET', providerRouting: { token: 'SECRET' } },
    resolved: { modelId: 'fixture', contextTier: 'long_context', authorization: 'SECRET' }, password: 'SECRET' });
  assert.deepEqual(model, { raw: { modelId: 'fixture', contextTier: null }, resolved: { modelId: 'fixture', contextTier: 'long_context' } });
  assert.deepEqual(copilotDiagnosticMetadata('model.snapshot', { raw: {}, resolved: {} }), { raw: {}, resolved: {} });
  assert.deepEqual(copilotDiagnosticMetadata('context.metadata', {}), { present: false });
  assert.deepEqual(copilotDiagnosticMetadata('context.metadata', { contextInfo: null }), { present: true, contextInfo: null });
  assert.deepEqual(copilotDiagnosticMetadata('context.metadata', { contextInfo: { totalTokens: 0, limit: 1050000, toolContents: 'SECRET' } }),
    { present: true, contextInfo: { totalTokens: 0, limit: 1050000 } });
  assert.deepEqual(copilotDiagnosticMetadata('model.catalog', { id: 'fixture', capabilities: { limits: { max_context_window_tokens: 1050000 } },
    billing: { tokenPrices: { maxPromptTokens: 272000, inputPrice: 'SECRET', longContext: { maxPromptTokens: 1050000 } } }, token: 'SECRET' }),
  { found: true, id: 'fixture', limits: { max_context_window_tokens: 1050000 }, tokenPrices: { maxPromptTokens: 272000, longContext: { maxPromptTokens: 1050000 } } });
  for (const metadata of [undefined, { id: 'fixture', capabilities: { limits: { max_context_window_tokens: 1050000 } }, billing: { tokenPrices: { maxPromptTokens: 272000 } } }]) {
    const projected = copilotDiagnosticMetadata('model.catalog', metadata);
    assert.deepEqual(copilotDiagnosticMetadata('model.catalog', projected), projected, 'bridge and frontend projections are idempotent');
  }
  const defaults = copilotDiagnosticMetadata('configuration.defaults', { settings: { contextTier: { value: null, default: null, isDefault: true }, githubToken: { value: 'SECRET' } } });
  assert.deepEqual(defaults, { settings: { contextTier: { value: null, default: null, isDefault: true } } });
  assert.equal(copilotDiagnosticMetadata('user.message', { content: 'SECRET' }), undefined);
  assert.equal(copilotDiagnosticMetadata('operation.failed', { method: 'prompt', error: 'SECRET' }), undefined);
  assert.deepEqual(copilotDiagnosticMetadata('operation.failed', { method: 'connect', outcome: 'error', error: 'SECRET', stack: 'SECRET' }), { method: 'connect', outcome: 'error' });
});

test('a failing configuration diagnostic observer never changes normal snapshot reads', async () => {
  const adapter = createCopilotConfiguration({ rpc: { user: { settings: { get: async () => ({ settings: {} }) } } } }, () => { throw new Error('logger failure'); });
  assert.deepEqual(await adapter.defaults(), {});
  const session = { rpc: { model: { getCurrent: async () => ({ modelId: 'fixture', contextTier: 'long_context' }) },
    mode: { get: async () => 'interactive', set: async () => ({ status: 'applied', modelChanged: false }) } }, setModel: async () => {} };
  const snapshot = await adapter.snapshot(session);
  assert.equal(snapshot.modelId, 'fixture'); assert.equal(snapshot.contextTier, 'long_context');
});
