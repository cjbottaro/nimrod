import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopilotConfiguration } from '../copilot/configuration.mjs';

const client = { rpc: { user: { settings: { get: async () => { throw new Error('Unexpected defaults read'); } } } } };
const setModel = async () => { throw new Error('Mode changes must not invoke setModel'); };
const model = { getCurrent: async () => ({ modelId: 'fixture' }) };

test('mode configuration uses a fresh precondition and reads the resulting model and mode', async () => {
  const calls: unknown[] = [];
  let mode = 'interactive';
  const session = {
    setModel,
    rpc: {
      mode: {
        get: async () => { calls.push('get-mode'); return mode; },
        set: async (params: { mode: string; expectedMode: string }) => {
          calls.push(params); mode = params.mode;
          return { status: 'applied', modeApplied: true, modelChanged: true, warning: 'Model changed', message: 'Plan ready', deprecationWarnings: ['Deprecated model'] };
        },
      },
      model: { getCurrent: async () => ({ modelId: 'plan-model', reasoningEffort: 'high' }) },
    },
  };
  const configuration = createCopilotConfiguration(client);
  assert.deepEqual(await configuration.apply(session, 'mode', 'plan'), {
    model: { modelId: 'plan-model', reasoningEffort: 'high', contextTier: undefined },
    mode: 'plan',
    notice: 'Model changed\nPlan ready\nDeprecated model',
  });
  assert.deepEqual(calls, ['get-mode', { mode: 'plan', expectedMode: 'interactive' }, 'get-mode']);
});

for (const [effect, label] of [
  ['confirmation', 'model confirmation'],
  ['deferImplementation', 'deferred implementation'],
  ['armInteractiveContinuation', 'interactive continuation'],
]) {
  test(`unsupported mode ${effect} fails without replay or speculative continuation`, async () => {
    let mutations = 0;
    const session = { setModel, rpc: { model, mode: {
      get: async () => 'plan',
      set: async () => { mutations++; return { status: 'applied', modeApplied: true, modelChanged: false, [effect]: true }; },
    } } };
    await assert.rejects(createCopilotConfiguration(client).apply(session, 'mode', 'autopilot'), new RegExp(label));
    assert.equal(mutations, 1);
  });
}

test('unknown mode is rejected before mutation and stale mode results are not retried', async () => {
  let mutations = 0;
  const session = { setModel, rpc: { model, mode: {
    get: async () => 'interactive',
    set: async () => { mutations++; return { status: 'stale', modeApplied: false, modelChanged: false }; },
  } } };
  const configuration = createCopilotConfiguration(client);
  await assert.rejects(configuration.apply(session, 'mode', 'unknown'), /Nothing was changed/);
  assert.equal(mutations, 0);
  await assert.rejects(configuration.apply(session, 'mode', 'plan'), /did not apply/);
  assert.equal(mutations, 1);
});
