import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopilotConfiguration } from '../src/copilot/session-configuration';

test('context choices use target-model metadata, not another model or a transient long-tier budget', async () => {
  const configuration = createCopilotConfiguration({
    models: () => [
      { id: 'a', label: 'A', maxContextTokens: 1_000_000 },
      { id: 'b', label: 'B', maxContextTokens: 2_000_000 },
    ],
    model: () => 'a', effort: () => undefined, mode: () => 'interactive', contextTier: () => 'long_context',
    contextLimit: (model, tier) => model === 'a' ? 128_000 : tier === 'default' ? 256_000 : undefined,
    availability: () => 'deferred', apply: async () => {}, changed() {}, error: assert.fail,
  });
  const choices = await configuration.choices('context-tier');
  assert.equal(choices[0].detail, '128k');
  assert.equal(choices[1].detail, '1M', 'usage observations cannot shrink the advertised maximum');
  const models = await configuration.choices('model');
  configuration.set('model', models[1]);
  const target = await configuration.choices('context-tier');
  assert.equal(target[0].detail, '256k', 'default limit belongs to the pending target model');
  assert.equal(target[1].detail, '2M');
  configuration.dispose();
});
