import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelThinkingController, type ModelIdentity } from '../src/pi/model-thinking-controller';
import { createPiConfiguration } from '../src/pi/session-configuration';
import type { SessionConfigurationController } from '../src/session-configuration';
import type { JsonRecord } from '../src/pi/types';

const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
async function fixture() {
  const models = [{ provider: 'first', id: 'same', name: 'Friendly' }, { provider: 'second', id: 'same' }];
  let current: ModelIdentity = models[0], effort = 'low', blocked = false, unavailable = false, scoped = models;
  const calls: { type: string; fields?: JsonRecord }[] = [], errors: string[] = [];
  let configuration: SessionConfigurationController | undefined;
  const controller = new ModelThinkingController({ request: async (type, fields) => {
    calls.push({ type, fields });
    if (type === 'get_state') return { data: { model: current, thinkingLevel: effort, isStreaming: true, isCompacting: true } };
    if (type === 'get_available_models') return { data: { models } };
    if (type === 'get_available_thinking_levels') return { data: { levels: ['low', 'high'] } };
    if (type === 'set_model') { current = models.find(model => model.provider === fields?.provider && model.id === fields?.modelId)!; effort = 'low'; return {}; }
    if (type === 'set_thinking_level') { effort = String(fields?.level); return {}; }
    throw new Error(`Unexpected RPC: ${type}`);
  } }, {
    isChangeBlocked: () => unavailable || blocked, onRpcState() {}, onState: () => configuration?.update(),
    chooseModel: async () => undefined, chooseThinkingLevel: async () => undefined, showError: error => errors.push(String(error)),
  });
  await controller.initialize({ model: current, thinkingLevel: effort });
  configuration = createPiConfiguration(controller, { unavailable: () => unavailable, blocked: () => blocked,
    scoped: available => available.filter(model => scoped.some(item => item.provider === model.provider && item.id === model.id)),
    changed() {}, error: message => errors.push(message) });
  return { configuration, calls, errors, block: () => { blocked = true; }, unblock: () => { blocked = false; configuration!.update(); },
    revoke: () => { scoped = [models[0]]; }, disconnect: () => { unavailable = true; configuration!.dispose(); controller.disconnect(); } };
}

test('Pi configuration preserves provider identity, fresh scope and changes during main work/compaction', async () => {
  const f = await fixture();
  const models = await f.configuration.choices('model');
  assert.notEqual(models[0].value, models[1].value);
  assert.deepEqual(models.map(({ label, detail, keywords }) => ({ label, detail, keywords })), [
    { label: 'Friendly', detail: 'first', keywords: 'same' },
    { label: 'same', detail: 'second', keywords: undefined },
  ]);
  assert.equal(f.configuration.get('model'), models[0].value);
  f.configuration.set('model', models[1]); await flush();
  assert.equal(f.configuration.get('model'), models[1].value);
  assert.deepEqual(f.calls.find(call => call.type === 'set_model')!.fields, { provider: 'second', modelId: 'same' });
  const levels = await f.configuration.choices('effort');
  f.configuration.set('effort', levels[1]); await flush();
  assert.equal(f.configuration.get('effort'), 'high');
  assert.equal(f.configuration.operations.at(-1)!.phase, 'completed');
  assert.equal(f.calls.some(call => call.type === 'prompt' || call.type === 'abort'), false);
  assert.deepEqual(f.errors, []); f.disconnect();
});

test('Pi prompt-acceptance blocking defers intent and revalidates scope before applying', async () => {
  const f = await fixture(); f.block();
  const models = await f.configuration.choices('model');
  f.configuration.set('model', models[1]); await flush();
  assert.equal(f.configuration.operations[0].phase, 'queued');
  assert.equal(f.calls.some(call => call.type === 'set_model'), false);
  f.unblock(); await flush();
  assert.equal(f.configuration.operations[0].phase, 'completed');
  assert.equal(f.configuration.get('model'), models[1].value);
  const revoked = await fixture(); revoked.block();
  const offered = await revoked.configuration.choices('model');
  revoked.configuration.set('model', offered[1]); revoked.revoke(); revoked.unblock(); await flush();
  assert.equal(revoked.calls.some(call => call.type === 'set_model'), false);
  assert.equal(revoked.configuration.operations[0].phase, 'failed');
  assert.equal(revoked.errors.length, 1);
  f.disconnect(); revoked.disconnect();
});
