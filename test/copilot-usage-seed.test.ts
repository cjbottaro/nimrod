import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotUsageController, presentCopilotUsage } from '../src/copilot/usage';
import { initialCopilotUsage } from '../src/copilot/usage-seed';

const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function fixture(fresh: boolean) {
  const credit: { resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const context: { resolve(value: unknown): void; reject(error: Error): void }[] = [];
  const controller = new CopilotUsageController(() => new Promise((resolve, reject) => credit.push({ resolve, reject })), () => {},
    () => new Promise((resolve, reject) => context.push({ resolve, reject })));
  controller.seed(initialCopilotUsage(fresh));
  const display = () => presentCopilotUsage(controller.snapshot);
  return { controller, credit, context, display };
}

test('fresh sessions seed display-only zeros while resumed sessions seed unknowns, without initiating reads', () => {
  const fresh = fixture(true), resumed = fixture(false);
  assert.equal(fresh.display().metrics, '~$0.000 · 0% / —');
  assert.equal(resumed.display().metrics, '— · — / —');
  assert.equal(fresh.controller.snapshot.credits, undefined, 'the seed is not zero billed AI credits');
  assert.equal(fresh.controller.snapshot.context, undefined, 'the seed is not a measured empty context');
  assert.match(fresh.display().metricsTitle!, /Provisional new-session cost/);
  assert.match(fresh.display().metricsTitle!, /actual usage and window have not been reported/);
  assert.equal(fresh.credit.length + fresh.context.length + resumed.credit.length + resumed.context.length, 0);
  fresh.controller.dispose(); resumed.controller.dispose();
});

for (const fresh of [true, false]) test(`one reconciliation pipeline retires each seed independently (${fresh ? 'new' : 'resume'})`, async () => {
  const f = fixture(fresh);
  f.controller.refresh(); f.controller.refreshContext();
  assert.equal(f.credit.length, 1); assert.equal(f.context.length, 1);
  f.credit[0].resolve({ totalNanoAiu: 0, aiCreditsStatus: 'complete' }); await flush();
  assert.equal(f.display().metrics, fresh ? '~$0.000 · 0% / —' : '~$0.000 · — / —');
  assert.equal(f.controller.snapshot.provisional?.credits, undefined);
  assert.equal(f.controller.snapshot.provisional?.context, fresh ? 'zero' : 'unknown');
  assert.match(f.display().metricsTitle!, /0 AIC/);
  assert.doesNotMatch(f.display().metricsTitle!, /Provisional new-session cost/);
  f.context[0].resolve(null); await flush();
  assert.equal(f.display().metrics, fresh ? '~$0.000 · 0% / —' : '~$0.000 · — / —');
  assert.equal(f.controller.snapshot.provisional?.context, fresh ? 'zero' : undefined);
  f.controller.context({ currentTokens: 31875, tokenLimit: 125000 });
  assert.equal(f.display().metrics, '~$0.000 · 25.5% / 125k');
  const confirmed = f.controller.snapshot;
  f.controller.seed(initialCopilotUsage(true));
  assert.equal(f.controller.snapshot, confirmed, 'routine initialization cannot resurrect the seed');
  f.controller.dispose();
});

test('empty successful reads preserve untouched zeros, while failures and newer live data keep their distinct meanings', async () => {
  const f = fixture(true); f.controller.refresh(); f.controller.refreshContext();
  f.credit[0].reject(new Error('optional metadata unavailable')); await flush();
  assert.equal(f.display().metrics, '— · 0% / —');
  f.controller.context({ currentTokens: 0, tokenLimit: 125000 });
  assert.equal(f.display().metrics, '— · 0% / 125k', 'only reported context can supply a window');
  f.context[0].reject(new Error('older context read failed')); await flush();
  assert.equal(f.display().metrics, '— · 0% / 125k');
  f.controller.dispose();
  const empty = fixture(true), seeded = empty.controller.snapshot; empty.controller.refresh(); empty.controller.refreshContext();
  empty.context[0].resolve({}); empty.credit[0].resolve({}); await flush();
  assert.equal(empty.display().metrics, '~$0.000 · 0% / —');
  assert.equal(empty.controller.snapshot, seeded, 'empty startup reads must not churn the display');
  assert.equal(empty.controller.snapshot.credits, undefined);
  assert.equal(empty.controller.snapshot.context, undefined);
  assert.equal(empty.credit.length + empty.context.length, 2, 'no polling to try to resolve a seed');
  empty.controller.workStarted();
  assert.equal(empty.display().metrics, '— · — / —');
  empty.controller.refresh(); empty.controller.refreshContext();
  empty.credit[1].resolve({}); empty.context[1].resolve(null); await flush();
  assert.equal(empty.display().metrics, '— · — / —', 'empty reads after work must never bring back zero');
  assert.equal(empty.controller.snapshot.provisional, undefined);
  empty.controller.dispose();
});

for (const response of [null, {}, { currentTokens: 0, tokenLimit: 0 }, { currentTokens: 0 }]) {
  test(`uninitialized context keeps a display seed without inventing a measurement (${JSON.stringify(response)})`, async () => {
    const f = fixture(true); f.controller.refreshContext(); f.context[0].resolve(response); await flush();
    assert.equal(f.display().metrics, '~$0.000 · 0% / —');
    assert.equal(f.controller.snapshot.context, undefined);
    f.controller.dispose();
  });
}

test('an actual context API error retires its zero even while untouched', async () => {
  const f = fixture(true); f.controller.refresh(); f.controller.refreshContext();
  f.credit[0].resolve({}); f.context[0].reject(new Error('metadata failure')); await flush();
  assert.equal(f.display().metrics, '~$0.000 · — / —');
  assert.equal(f.controller.snapshot.provisional?.context, undefined);
  assert.equal(f.controller.snapshot.provisional?.credits, 'zero');
  f.controller.dispose();
});

test('startup model resolution fences old windows but does not consume a windowless untouched seed', async () => {
  const f = fixture(true), seeded = f.controller.snapshot;
  f.controller.refreshContext(); f.controller.clearContext(); f.controller.refreshContext();
  f.context[0].resolve({ currentTokens: 5, tokenLimit: 125000 }); await flush();
  assert.equal(f.controller.snapshot, seeded);
  f.context[1].resolve(null); await flush();
  assert.equal(f.display().metrics, '~$0.000 · 0% / —');
  assert.equal(f.controller.snapshot.context, undefined, 'never import a window from the prior model');
  f.controller.dispose();
});

test('first work fences pre-work zero snapshots and repeated activity does not reset or poll', async () => {
  const f = fixture(true); f.controller.refresh(); f.controller.refreshContext();
  f.controller.workStarted();
  assert.equal(f.display().metrics, '— · — / —');
  f.credit[0].resolve({ totalNanoAiu: 0, aiCreditsStatus: 'complete' });
  f.context[0].resolve({ currentTokens: 0, tokenLimit: 125000 }); await flush();
  assert.equal(f.display().metrics, '— · — / —', 'late explicit zeros from before Send must be ignored');
  assert.equal(f.credit.length, 2); assert.equal(f.context.length, 2);
  f.credit[1].resolve({ totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' });
  f.context[1].resolve({ currentTokens: 31875, tokenLimit: 125000 }); await flush();
  assert.equal(f.display().metrics, '~$0.123 · 25.5% / 125k');
  const confirmed = f.controller.snapshot;
  for (let index = 0; index < 100; index++) f.controller.workStarted();
  assert.equal(f.controller.snapshot, confirmed);
  assert.equal(f.credit.length + f.context.length, 4);
  f.controller.dispose();
});

for (const response of [null, {}, { totalNanoAiu: 0, aiCreditsStatus: 'unavailable' }]) {
  test(`unreported startup accounting can retain only a provisional zero (${JSON.stringify(response)})`, async () => {
    const f = fixture(true); f.controller.refresh(); f.credit[0].resolve(response); await flush();
    assert.equal(f.display().metrics, '~$0.000 · 0% / —');
    assert.equal(f.controller.snapshot.credits, undefined);
    assert.match(f.display().metricsTitle!, /Provisional new-session cost/);
    f.controller.dispose();
  });
}

for (const response of [{ totalNanoAiu: -1 }, { totalNanoAiu: 'not a number' }, { totalNanoAiu: 1, aiCreditsStatus: 'unavailable' }]) {
  test(`invalid or contradictory accounting is not hidden by an optimistic zero (${JSON.stringify(response)})`, async () => {
    const f = fixture(true); f.controller.refresh(); f.credit[0].resolve(response); await flush();
    assert.equal(f.display().metrics, '— · 0% / —');
    assert.equal(f.controller.snapshot.provisional?.credits, undefined);
    f.controller.dispose();
  });
}

test('work observed before the initial display bind cannot later gain an optimistic seed', () => {
  const controller = new CopilotUsageController(async () => ({}), () => {});
  controller.workStarted(); controller.seed(initialCopilotUsage(true));
  assert.equal(presentCopilotUsage(controller.snapshot).metrics, '— · — / —');
  controller.dispose();
});

test('seeding cannot replace already reported values, and disposal cannot leave optimistic zeros behind', async () => {
  const controller = new CopilotUsageController(async () => ({ totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' }), () => {});
  controller.context({ currentTokens: 31875, tokenLimit: 125000 }); controller.refresh(); await flush();
  const before = controller.snapshot;
  controller.seed(initialCopilotUsage(true));
  assert.equal(controller.snapshot, before);
  assert.equal(presentCopilotUsage(controller.snapshot).metrics, '~$0.123 · 25.5% / 125k');
  controller.dispose();
  const pending = fixture(true); pending.controller.refresh(); pending.controller.refreshContext();
  pending.controller.dispose();
  assert.equal(pending.controller.snapshot.provisional, undefined);
  pending.credit[0].resolve({ totalNanoAiu: 999_000_000_000, aiCreditsStatus: 'complete' });
  pending.context[0].resolve({ currentTokens: 999, tokenLimit: 1000 }); await flush();
  assert.equal(pending.display().metrics, undefined);
});
