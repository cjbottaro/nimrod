import assert from 'node:assert/strict';
import test from 'node:test';
import { startPiSession, type PiLaunchInfo } from '../src/pi/session-startup';
import type { Packet } from '../src/pi/transport';

const file = { path: '/fixture/session.jsonl', sessionId: 'saved-id', exists: true };
const first: Packet = { kind: 'rpc', value: { type: 'first' } };
const second: Packet = { kind: 'rpc', value: { type: 'second' } };

test('Pi startup binds validated identity before ordered packets, then initializes; live packets retain generation guard', async () => {
  const order: string[] = [];
  let receive!: (packet: Packet) => void;
  let current = true;
  await startPiSession({ mode: 'resume', sessionId: file.sessionId }, {
    start: async callback => { receive = callback; receive(first); receive(second); return { cwd: '/fixture', session: file }; },
    currentProject: () => '/fixture', current: () => current,
    receive: packet => { if (packet.kind === 'rpc') order.push(String(packet.value.type)); },
    validated: info => { assert.deepEqual(info.session, file); order.push('bind'); },
    initialize: async () => { order.push('initialize'); },
  });
  assert.deepEqual(order, ['bind', 'first', 'second', 'initialize']);
  receive(first);
  assert.equal(order.at(-1), 'first');
  current = false; receive(second);
  assert.equal(order.at(-1), 'first');
});

for (const [name, info, error] of [
  ['wrong project', { cwd: '/other', session: file }, /confirm this project/],
  ['missing identity', { cwd: '/fixture' }, /validate the selected session/],
  ['replaced identity', { cwd: '/fixture', session: { ...file, sessionId: 'other' } }, /different session/],
] as const) {
  test(`Pi startup rejects ${name} before binding, replay or initialization`, async () => {
    const effects: string[] = [];
    await assert.rejects(startPiSession({ mode: 'resume', sessionId: file.sessionId }, {
      start: async receive => { receive(first); return info as PiLaunchInfo; },
      currentProject: () => '/fixture', current: () => true,
      receive: () => { effects.push('packet'); }, validated: () => { effects.push('bind'); },
      initialize: async () => { effects.push('initialize'); },
    }), error);
    assert.deepEqual(effects, []);
  });
}

test('Pi startup propagates initialization failure without replaying buffered packets', async () => {
  let packets = 0;
  await assert.rejects(startPiSession({ mode: 'saved' }, {
    start: async receive => { receive(first); return { cwd: '/fixture' }; },
    currentProject: () => '/fixture', current: () => true,
    receive: () => { packets++; }, validated() {},
    initialize: async () => { throw new Error('Initialization failed'); },
  }), /Initialization failed/);
  assert.equal(packets, 1);
});
