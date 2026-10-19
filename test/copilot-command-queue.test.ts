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
  const first = queue.enqueue('one', '/one'), second = queue.enqueue('two', '/two');
  const queued = queue.operations;
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
  const first = queue.enqueue('one', '/one'), second = queue.enqueue('two', '/two');
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
  await queue.enqueue('one', '/one');
  assert.deepEqual(queue.operations, []);
  await queue.enqueue('two', '/two');
  assert.equal(queue.operations[0].phase, 'failed');
  assert.match(queue.operations[0].details!, /Known unsupported/);
  queue.update(); await flush();
  assert.equal(runs, 2);
});
