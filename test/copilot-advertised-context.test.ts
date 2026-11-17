import assert from 'node:assert/strict';
import test from 'node:test';
import { advertisedCopilotContextLimit, presentCopilotUsage } from '../src/copilot/usage';
import { initialCopilotUsage } from '../src/copilot/usage-seed';
import { createCopilotStatusArea } from '../src/copilot/status-area';

const model = { id: 'fixture', capabilities: { limits: { max_context_window_tokens: 2_000_000 } },
  billing: { tokenPrices: { maxPromptTokens: 128_000, longContext: { maxPromptTokens: 936_000 } } } };

test('catalog capacity uses the confirmed tier prompt budget, never combined context or output capacity', () => {
  assert.equal(advertisedCopilotContextLimit(model, 'default'), 128_000);
  assert.equal(advertisedCopilotContextLimit(model, 'long_context'), 936_000);
  for (const tier of [undefined, 'unknown', '']) assert.equal(advertisedCopilotContextLimit(model, tier), undefined);
  for (const id of ['auto', 'fusion']) assert.equal(advertisedCopilotContextLimit({ ...model, id }, 'default'), undefined);
  assert.equal(advertisedCopilotContextLimit({ id: 'maximum-only', capabilities: model.capabilities }, 'default'), undefined);
  assert.equal(advertisedCopilotContextLimit({ id: 'default-only', billing: { tokenPrices: { maxPromptTokens: 128_000 } } }, 'long_context'), undefined);
});

for (const budget of [0, -1, NaN, Infinity, '128000', null, undefined]) {
  test(`invalid or missing catalog budget is not displayed (${String(budget)})`, () => {
    assert.equal(advertisedCopilotContextLimit({ id: 'fixture', billing: { tokenPrices: { maxPromptTokens: budget } } }, 'default'), undefined);
  });
}

test('fresh and resumed usage share a provisional catalog window without inventing measured utilization', () => {
  for (const fresh of [true, false]) {
    const usage = { provisional: initialCopilotUsage(fresh) };
    const projected = presentCopilotUsage(usage, true, 128_000);
    assert.equal(projected.metrics, fresh ? '~$0.000 · 0% / ~128k' : '— · — / ~128k');
    assert.match(projected.metricsTitle!, /Provisional context window: 128,000 prompt tokens/);
    assert.match(projected.metricsTitle!, /not the effective session limit/);
    assert.equal(projected.metricParts?.find(part => part.actionId)?.text, '~128k');
    assert.deepEqual(usage, { provisional: initialCopilotUsage(fresh) }, 'projection never mutates reported usage or its seed');
  }
  assert.equal(presentCopilotUsage({}, false, 128_000).metrics, '— / ~128k', 'a window is not a zero-usage claim');
  assert.equal(presentCopilotUsage({ context: { currentTokens: 1000, tokenLimit: 0 } }, false, 128_000).metrics,
    '— / ~128k', 'never calculate a percentage from a provisional budget');
});

test('reported capacity wins over the catalog and loses the provisional marker', () => {
  const projected = presentCopilotUsage({ context: { currentTokens: 31_250, tokenLimit: 125_000 } }, true, 128_000);
  assert.equal(projected.metrics, '25% / 125k');
  assert.doesNotMatch(projected.metricsTitle!, /Provisional context window/);
  assert.equal(projected.metricParts?.find(part => part.actionId)?.text, '125k');
});

test('catalog changes invalidate only usage projection and preserve controls and stable snapshots', () => {
  const project = createCopilotStatusArea();
  const state = { model: 'fixture', supportsModel: true, supportsThinking: false, supportsMode: false,
    supportsContext: true, available: true, usage: { provisional: initialCopilotUsage(true) } };
  const standard = project({ ...state, advertisedContextLimit: 128_000 });
  const extended = project({ ...state, advertisedContextLimit: 936_000 });
  assert.equal(extended.metrics, '~$0.000 · 0% / ~936k');
  assert.equal(extended.controls, standard.controls);
  assert.equal(project({ ...state, advertisedContextLimit: 936_000 }), extended);
  const unresolved = project(state);
  assert.equal(unresolved.metrics, '~$0.000 · 0% / —');
  assert.equal(unresolved.controls, standard.controls);
});
