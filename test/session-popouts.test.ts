import assert from 'node:assert/strict';
import test from 'node:test';
import { installSessionPopouts, type PopoutSessionBinding, type PopoutSnapshot } from '../src/session-popouts';

const a: PopoutSessionBinding = { runtimeId: 'a', pi: { path: '/sessions/a.jsonl', sessionId: 'pi-a' } };
const b: PopoutSessionBinding = { runtimeId: 'b', pi: null };
const snapshot: PopoutSnapshot = { session: 'a', title: 'A', text: '# Reference\n', language: 'md' };

test('pop-out selections coalesce while opens wait for native session registration', async () => {
  const calls: unknown[] = [];
  const controller = installSessionPopouts({
    sync: async (sessions, active) => { calls.push({ sessions, active }); return { warnings: [] }; },
    open: async value => { calls.push(value); }, error: assert.fail,
  });
  controller.sync([a, b], 'a'); controller.sync([a, b], 'b'); controller.sync([a, b], 'a');
  controller.open(snapshot, () => true);
  await controller.settled();
  assert.deepEqual(calls, [{ sessions: [a, b], active: 'a' }, snapshot]);
});

test('late opens cannot focus a session that was switched away from or closed', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let selected = 'a'; const calls: string[] = [];
  const controller = installSessionPopouts({
    sync: async (_sessions, active) => { calls.push(`select:${active}`); if (active === 'a') await gate; return { warnings: [] }; },
    open: async () => { calls.push('open'); }, error: assert.fail,
  });
  controller.sync([a, b], 'a'); await Promise.resolve(); await Promise.resolve();
  controller.open(snapshot, () => selected === 'a');
  selected = 'b'; controller.sync([a, b], 'b'); release(); await controller.settled();
  assert.deepEqual(calls, ['select:a', 'select:b']);
  controller.sync([], null); await controller.settled();
  assert.equal(calls.at(-1), 'select:null');
});

test('background identity promotion retains selected session and reports restoration failures', async () => {
  const calls: unknown[] = []; const errors: string[] = [];
  const controller = installSessionPopouts({
    sync: async (sessions, active) => { calls.push({ sessions, active }); return { warnings: ['Missing snapshot file'] }; },
    open: async () => { throw new Error('disk write failed'); }, error: message => errors.push(message),
  });
  controller.sync([{ ...a, pi: null }, b], 'b'); await controller.settled();
  controller.sync([a, b], 'b'); await controller.settled();
  assert.deepEqual(calls.at(-1), { sessions: [a, b], active: 'b' });
  controller.open(snapshot, () => true); await controller.settled();
  assert.ok(errors.some(error => error.includes('Missing snapshot file')));
  assert.ok(errors.some(error => error.includes('disk write failed')));
  controller.sync([a, b], 'b'); await controller.settled(); // Failure doesn't poison the queue.
  assert.equal(calls.length, 3);
});

test('disposal suppresses queued native mutations and late error messages', async () => {
  const calls: unknown[] = [];
  const controller = installSessionPopouts({ sync: async () => { calls.push('sync'); return { warnings: [] }; },
    open: async () => { calls.push('open'); }, error: assert.fail });
  controller.sync([a], 'a'); controller.open(snapshot, () => true); controller.dispose();
  await controller.settled(); assert.deepEqual(calls, []);
});
