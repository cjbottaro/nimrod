import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotCommandQueue } from '../src/copilot/command-queue';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('queue holds later work until an active workflow settles, including an explicit agent prompt starting work', async () => {
  let ready = false;
  const calls: string[] = [];
  let finish!: () => void;
  const queue = new CopilotCommandQueue(() => ready, async (_id, text, _signal, dispatched) => {
    calls.push(text); dispatched();
    await new Promise<void>(resolve => { finish = resolve; });
  }, () => {});
  const first = queue.enqueue('one', '/one', 'before'), second = queue.enqueue('two', '/two', 'before');
  const queued = queue.operations;
  assert.ok(queue.operations.every(operation => operation.settlementAnchor === 'before'));
  queue.update(); assert.equal(queue.operations, queued);
  ready = true; queue.update(); queue.update();
  assert.deepEqual(calls, ['/one']);
  ready = false; finish(); await first; await flush();
  assert.deepEqual(calls, ['/one']);
  assert.deepEqual(queue.operations.map(operation => operation.phase), ['completed', 'queued']);
  ready = true; queue.update();
  assert.deepEqual(calls, ['/one', '/two']);
  finish(); await second;
});

test('disconnect distinguishes dispatched uncertainty from undelivered intent and suppresses late settlement', async () => {
  let finish!: () => void;
  const queue = new CopilotCommandQueue(() => true, async (_id, _text, _signal, dispatched) => {
    dispatched(); await new Promise<void>(resolve => { finish = resolve; });
  }, () => {});
  const first = queue.enqueue('one', '/one', null), second = queue.enqueue('two', '/two', null);
  queue.cancel('Disconnected');
  assert.deepEqual(queue.operations.map(operation => operation.phase), ['unknown', 'not-applied']);
  assert.ok(queue.operations.every(operation => operation.cause === 'connection'));
  const terminal = queue.operations;
  finish(); await first; await second;
  assert.equal(queue.operations, terminal);
});

test('picker cancellation removes only its command card; failure settles once without retry', async () => {
  let runs = 0;
  const queue = new CopilotCommandQueue(() => true, async () => {
    if (++runs === 1) return false;
    throw new Error('Known unsupported result');
  }, () => {});
  await queue.enqueue('one', '/one', null);
  assert.equal(queue.operations.length, 0);
  await queue.enqueue('two', '/two', null);
  assert.equal(queue.operations[0].phase, 'failed');
  assert.equal(queue.operations[0].inlineError, 'Known unsupported result');
  assert.equal(queue.operations[0].details, undefined);
  queue.update(); await flush();
  assert.equal(runs, 2);
});

test('head command dispatches during work only when its concrete metadata permits live use', async () => {
  let busy = true;
  const calls: string[] = [];
  const queue = new CopilotCommandQueue(text => !busy || text === '/live', async (_id, text) => { calls.push(text); }, () => {});
  const live = queue.enqueue('live', '/live', null); await live;
  assert.deepEqual(calls, ['/live']);
  const idle = queue.enqueue('idle', '/idle', null); await flush();
  assert.deepEqual(calls, ['/live']);
  assert.equal(queue.operations.at(-1)?.phase, 'queued');
  busy = false; queue.update(); await idle;
  assert.deepEqual(calls, ['/live', '/idle']);
});
