import assert from 'node:assert/strict';
import test from 'node:test';
import { completeCommandEffect } from '../copilot/command-effects.mjs';

function fixture(options: { setError?: Error; current?: Record<string, unknown>; finalize?: { success: boolean; error?: string } } = {}) {
  const switches: unknown[] = [], finalizations: unknown[] = [];
  const session = {
    async setModel(model: string, settings?: unknown) {
      switches.push({ model, settings });
      if (options.setError) throw options.setError;
    },
    rpc: {
      model: { getCurrent: async () => options.current ?? { modelId: 'large', reasoningEffort: 'high' } },
      commands: { finalizeInvocationEffect: async (request: unknown) => {
        finalizations.push(request); return options.finalize ?? { success: true };
      } },
    },
  };
  return { session, switches, finalizations };
}

test('model command effects apply live state and finalize the unchanged effect', async () => {
  const f = fixture();
  const effect = { kind: 'set-model', model: 'large', reasoningEffort: 'high', runtimeSettingsChanged: true, revertOnCancel: { model: 'small' } };
  const result = await completeCommandEffect(f.session, effect);
  assert.deepEqual(f.switches, [{ model: 'large', settings: { reasoningEffort: 'high' } }]);
  assert.deepEqual(f.finalizations, [{ effect, outcome: 'applied' }]);
  assert.equal(result.effectFinalized, true);
  assert.equal(result.commandApplied, true);
  assert.deepEqual(result.configuration, { modelId: 'large', reasoningEffort: 'high' });
});

test('builtin model completed fallback applies an exact enabled catalog model and reconciles it', async () => {
  const f = fixture({ current: { modelId: 'large' } });
  const result = await completeCommandEffect(f.session, { kind: 'completed' }, {
    command: { kind: 'builtin', name: 'model' }, input: 'large',
    models: async () => [{ id: 'small', policy: { state: 'disabled' } }, { id: 'large', policy: { state: 'enabled' } }],
  });
  assert.deepEqual(f.switches, [{ model: 'large', settings: undefined }]);
  assert.deepEqual(f.finalizations, []);
  assert.equal(result.kind, 'set-model');
  assert.equal(result.commandApplied, true);
  assert.deepEqual(result.configuration, { modelId: 'large' });
});

test('model completion fallback does not guess unsupported syntax or unadvertised models', async () => {
  for (const context of [
    { command: { kind: 'client', name: 'model' }, input: 'large' },
    { command: { kind: 'builtin', name: 'model' }, input: '--repo large' },
    { command: { kind: 'builtin', name: 'model' }, input: 'disabled' },
  ]) {
    const f = fixture();
    const result = await completeCommandEffect(f.session, { kind: 'completed' }, {
      ...context, models: async () => [{ id: 'large' }, { id: 'disabled', policy: { state: 'disabled' } }],
    });
    assert.deepEqual(result, { kind: 'completed' });
    assert.deepEqual(f.switches, []);
  }
});

test('invalid effects cancel provisional settings without attempting a model mutation', async () => {
  const f = fixture();
  const effect = { kind: 'set-model', model: '' };
  const result = await completeCommandEffect(f.session, effect);
  assert.deepEqual(f.switches, []);
  assert.deepEqual(f.finalizations, [{ effect, outcome: 'cancelled' }]);
  assert.equal(result.kind, 'command-effect-failed');
  assert.equal(result.outcome, 'cancelled');
});

test('failed or unconfirmed model mutations cancel persistence and require reconciliation', async () => {
  for (const f of [
    fixture({ setError: new Error('switch rejected') }),
    fixture({ current: { modelId: 'small', reasoningEffort: 'low' } }),
  ]) {
    const effect = { kind: 'set-model', model: 'large', reasoningEffort: 'high' };
    const result = await completeCommandEffect(f.session, effect);
    assert.equal(result.kind, 'command-effect-failed');
    assert.equal(result.outcome, 'unknown');
    assert.deepEqual(f.finalizations, [{ effect, outcome: 'cancelled' }]);
  }
});

test('plan-model effects finalize their provisional future-session preference', async () => {
  const f = fixture();
  const effect = { kind: 'set-plan-model', planModel: 'large', message: 'Plan model set', runtimeSettingsChanged: true };
  const result = await completeCommandEffect(f.session, effect);
  assert.deepEqual(f.switches, []);
  assert.deepEqual(f.finalizations, [{ effect, outcome: 'applied' }]);
  assert.equal(result.effectFinalized, true);
});

test('failed applied finalization is uncertain and is never retried as cancellation', async () => {
  const f = fixture({ finalize: { success: false, error: 'persistence unavailable' } });
  const effect = { kind: 'set-model', model: 'large', reasoningEffort: 'high' };
  const result = await completeCommandEffect(f.session, effect);
  assert.equal(result.kind, 'command-effect-failed');
  assert.equal(result.outcome, 'unknown');
  assert.deepEqual(f.finalizations, [{ effect, outcome: 'applied' }]);
});
