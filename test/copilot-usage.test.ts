import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotUsageController, presentCopilotUsage } from '../src/copilot/usage';
import { CopilotConnection, type BridgeRequest } from '../src/copilot/connection';

const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
test('Copilot formats USD equivalent, exact AIC detail and context utilization without using request multipliers', () => {
  const display = presentCopilotUsage({ credits: { nanoAiu: 12_300_000_000, status: 'complete' }, context: { currentTokens: 31875, tokenLimit: 125000 } });
  assert.equal(display.metrics, '~$0.123 · 25.5% / 125k');
  assert.match(display.metricsTitle!, /12\.3 AIC/);
  assert.match(display.metricsTitle!, /31,875 \/ 125,000 tokens/);
  assert.match(display.metricsTitle!, /not necessarily an additional charge/);
  assert.equal(presentCopilotUsage({ context: { currentTokens: 280500, tokenLimit: 1100000 } }).metrics, '25.5% / 1.1M');
  assert.equal(presentCopilotUsage({ context: { currentTokens: 200000, tokenLimit: 125000 } }).metrics, '160% / 125k', 'do not clamp reported utilization');
  assert.equal(presentCopilotUsage({ context: { currentTokens: 0, tokenLimit: 0 } }).metrics, '— / —');
  assert.deepEqual(presentCopilotUsage({ context: { currentTokens: NaN, tokenLimit: Infinity } }), {});
  assert.equal(presentCopilotUsage({ credits: { nanoAiu: 0, status: 'complete' } }).metrics, '~$0.000 · — / —');
});

test('partial or unknown coverage is a lower bound, and absent accounting is not a zero-cost claim', async () => {
  const partial = presentCopilotUsage({ credits: { nanoAiu: 12_399_999_999, status: 'partial' } });
  assert.equal(partial.metrics, '≥$0.123 · — / —', 'round a lower bound down rather than up');
  assert.match(partial.metricsTitle!, /12\.399999999 AIC reported subtotal/);
  assert.match(partial.metricsTitle!, /Partial accounting/);
  assert.equal(presentCopilotUsage({ credits: { nanoAiu: 12_300_000_000, status: 'unknown' } }).metrics, '≥$0.123 · — / —');
  assert.equal(presentCopilotUsage({ credits: { nanoAiu: 0, status: 'unknown' } }).metrics, '— · — / —');
  for (const response of [null, {}, { totalNanoAiu: 0 }, { totalNanoAiu: 9, aiCreditsStatus: 'unavailable' },
    { aiCreditsStatus: 'complete' }, { totalNanoAiu: -1, aiCreditsStatus: 'complete' }, { totalNanoAiu: NaN }, { totalPremiumRequestCost: 999 }]) {
    const controller = new CopilotUsageController(async () => response, () => {});
    controller.refresh(); await flush();
    assert.equal(presentCopilotUsage(controller.snapshot).metrics, '— · — / —');
    controller.dispose();
  }
});

test('aggregate usage reads coalesce, discard stale totals and retain unchanged snapshot references', async () => {
  const reads: { resolve(value: unknown): void }[] = [];
  let publications = 0;
  const controller = new CopilotUsageController(() => new Promise(resolve => reads.push({ resolve })), () => { publications++; });
  controller.context({ currentTokens: 31875, tokenLimit: 125000 });
  const context = controller.snapshot.context;
  controller.refresh();
  for (let index = 0; index < 100; index++) controller.refresh();
  assert.equal(reads.length, 1);
  reads[0].resolve({ totalNanoAiu: 999_000_000_000, aiCreditsStatus: 'complete' }); await flush();
  assert.equal(controller.snapshot.credits, undefined, 'a result predating a newer usage event must not flash');
  assert.equal(reads.length, 2);
  reads[1].resolve({ totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' }); await flush();
  assert.equal(controller.snapshot.context, context);
  const snapshot = controller.snapshot, count = publications;
  controller.context({ currentTokens: 31875, tokenLimit: 125000 });
  controller.refresh(); reads[2].resolve({ totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' }); await flush();
  assert.equal(controller.snapshot, snapshot);
  assert.equal(publications, count);
  controller.context({ currentTokens: -1, tokenLimit: 125000 });
  assert.equal(controller.snapshot, snapshot);
  controller.clearContext();
  assert.equal(controller.snapshot.context, undefined);
  assert.equal(controller.snapshot.credits, snapshot.credits, 'model context invalidation does not reset session spending');
  controller.dispose(); controller.refresh();
  assert.equal(reads.length, 3);
});

test('metadata failure and late completion do not erase context, poll, or revive a disposed owner', async () => {
  let reads = 0, resolve!: (value: unknown) => void;
  const controller = new CopilotUsageController(async () => {
    reads++;
    if (reads === 1) throw new Error('metadata unsupported');
    return new Promise(done => { resolve = done; });
  }, () => {});
  controller.context({ currentTokens: 10, tokenLimit: 100 });
  controller.refresh(); await flush();
  assert.equal(presentCopilotUsage(controller.snapshot).metrics, '— · 10% / 100');
  assert.equal(reads, 1, 'failed optional reads do not start a retry timer');
  controller.refresh(); const before = controller.snapshot;
  controller.dispose(); resolve({ totalNanoAiu: 99_000_000_000, aiCreditsStatus: 'complete' }); await flush();
  assert.equal(controller.snapshot, before);
});

test('reconnect context is fetched independently of credits, without needing a usage event', async () => {
  let resolveContext!: (value: unknown) => void;
  const controller = new CopilotUsageController(async () => ({ totalNanoAiu: 69_100_000_000, aiCreditsStatus: 'complete' }), () => {},
    () => new Promise(resolve => { resolveContext = resolve; }));
  controller.refresh(); controller.refreshContext(); await flush();
  assert.equal(presentCopilotUsage(controller.snapshot).metrics, '~$0.691 · — / —', 'a slow context read must not hold cost hostage');
  resolveContext({ currentTokens: 31875, tokenLimit: 125000 }); await flush();
  assert.equal(presentCopilotUsage(controller.snapshot).metrics, '~$0.691 · 25.5% / 125k');
  controller.dispose();
});

test('null or failed cold-resume context keeps the unknown slot without hiding credits or fabricating zero', async () => {
  for (const fail of [false, true]) {
    let reads = 0;
    const controller = new CopilotUsageController(async () => ({ totalNanoAiu: 69_100_000_000, aiCreditsStatus: 'complete' }), () => {}, async () => {
      reads++; if (fail) throw new Error('uninitialized context'); return null;
    });
    controller.refresh(); controller.refreshContext(); await flush();
    assert.equal(presentCopilotUsage(controller.snapshot).metrics, '~$0.691 · — / —');
    assert.equal(reads, 1, 'no probing/polling loop while the runtime is uninitialized');
    assert.match(presentCopilotUsage(controller.snapshot).metricsTitle!, /Context usage\/window is not reported/);
    controller.dispose();
  }
});

test('live context, model invalidation and disposal fence stale metadata independently of credit reads', async () => {
  const reads: { resolve(value: unknown): void }[] = [];
  const controller = new CopilotUsageController(async () => ({}), () => {}, () => new Promise(resolve => reads.push({ resolve })));
  controller.context({ currentTokens: 10, tokenLimit: 100 });
  controller.refreshContext();
  const current = controller.snapshot;
  controller.context({ currentTokens: 10, tokenLimit: 100 });
  reads[0].resolve({ currentTokens: 99, tokenLimit: 100 }); await flush();
  assert.equal(controller.snapshot, current, 'an identical live observation still outranks an older read');
  controller.refreshContext();
  controller.clearContext();
  for (let index = 0; index < 100; index++) controller.refreshContext();
  assert.equal(reads.length, 2);
  reads[1].resolve({ currentTokens: 900, tokenLimit: 1000 }); await flush();
  assert.equal(controller.snapshot.context, undefined, 'do not resurrect the old model context');
  assert.equal(reads.length, 3);
  reads[2].resolve({ currentTokens: 5, tokenLimit: 200 }); await flush();
  assert.deepEqual(controller.snapshot.context, { currentTokens: 5, tokenLimit: 200 });
  controller.refreshContext(); const latest = controller.snapshot;
  controller.dispose(); reads[3].resolve({ currentTokens: 9000, tokenLimit: 10000 }); await flush();
  assert.equal(controller.snapshot, latest);
  controller.refreshContext(); assert.equal(reads.length, 4);
});

test('optional metadata timeout rejects only its request; a late result cannot interfere with a live prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: BridgeRequest[] = [], ended: string[] = [];
  const connection = new CopilotConnection(async message => { sent.push(message); }, () => {}, reason => ended.push(reason));
  try {
    const read = connection.request('usage', {}, 'reject');
    const rejected = assert.rejects(read, /metadata request timed out/);
    t.mock.timers.tick(20_000); await rejected;
    assert.deepEqual(ended, []);
    const prompt = connection.request('prompt', { text: 'fixture only' });
    connection.receive({ kind: 'result', id: sent[0].id, result: { totalNanoAiu: 999 } });
    connection.receive({ kind: 'result', id: sent[1].id, result: { messageId: 'accepted' } });
    assert.deepEqual(await prompt, { messageId: 'accepted' });
    assert.deepEqual(ended, []);
  } finally { connection.disconnect('fixture complete'); t.mock.timers.reset(); }
});
