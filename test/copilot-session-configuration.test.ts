import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopilotConfiguration } from '../src/copilot/session-configuration';
import { pickConfiguration } from '../src/configuration-picker';

function fixture() {
  let tier: string | undefined;
  const limits = new Map<string, number>();
  const configuration = createCopilotConfiguration({
    models: () => [
      { id: 'a', label: 'A', maxContextTokens: 1_050_000, defaultContextTokens: 272_000, longContextTokens: 922_000 },
      { id: 'b', label: 'B', maxContextTokens: 2_000_000, defaultContextTokens: 384_000, longContextTokens: 1_800_000 },
      { id: 'missing-budgets', label: 'Missing budgets', maxContextTokens: 2_000_000 },
    ],
    model: () => 'a', effort: () => undefined, mode: () => 'interactive', contextTier: () => tier,
    contextLimit: (model, tier) => limits.get(`${model}:${tier}`),
    availability: () => 'deferred', apply: async () => { assert.fail('picker reads must not configure the harness'); }, changed() {}, error: assert.fail,
  });
  return { configuration, limits, tier(value?: string) { tier = value; } };
}

test('unknown context tier stays unselected in the existing generic picker', async () => {
  const f = fixture();
  try {
    assert.equal(f.configuration.get('context-tier'), undefined);
    await pickConfiguration(f.configuration, 'context-tier', async (choices, current) => {
      assert.equal(current, undefined);
      assert.deepEqual(choices.map(choice => choice.detail), ['272k', '922k']);
      return undefined;
    });
    f.tier('long_context'); assert.equal(f.configuration.get('context-tier'), 'long_context');
    f.tier('default'); assert.equal(f.configuration.get('context-tier'), 'default');
    assert.equal(f.configuration.operations.length, 0);
  } finally { f.configuration.dispose(); }
});

test('both context choices use tier prompt budgets, not the combined context maximum', async () => {
  const f = fixture();
  try {
    const choices = await f.configuration.choices('context-tier');
    assert.deepEqual(choices.map(choice => choice.detail), ['272k', '922k']);
    const models = await f.configuration.choices('model');
    f.configuration.set('model', models[1]);
    const target = await f.configuration.choices('context-tier');
    assert.deepEqual(target.map(choice => choice.detail), ['384k', '1.8M']);
    f.configuration.set('model', models[2]);
    assert.ok((await f.configuration.choices('context-tier')).every(choice => choice.detail === undefined), 'missing prompt budgets never fall back to combined maximum');
  } finally { f.configuration.dispose(); }
});

test('reported limits override only their exact model and tier, including a pending target model', async () => {
  const f = fixture();
  try {
    f.limits.set('a:default', 260_000); f.limits.set('a:long_context', 900_000); f.limits.set('b:default', 370_000);
    assert.deepEqual((await f.configuration.choices('context-tier')).map(choice => choice.detail), ['260k', '900k']);
    const models = await f.configuration.choices('model');
    f.configuration.set('model', models[1]);
    assert.deepEqual((await f.configuration.choices('context-tier')).map(choice => choice.detail), ['370k', '1.8M']);
  } finally { f.configuration.dispose(); }
});
