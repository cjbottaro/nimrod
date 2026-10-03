import assert from 'node:assert/strict';
import test from 'node:test';
import { PiSession, type SessionUi } from '../src/pi/session';
import { PiTransport } from '../src/pi/transport';
import type { JsonRecord } from '../src/pi/types';
import type { HostMessage } from '../src/pi/webview-client';

function fixture() {
  const sent: JsonRecord[] = [], published: HostMessage[] = [];
  const rpc = new PiTransport(async message => { sent.push(message); });
  const ui: SessionUi = { publish: m => published.push(m), changed: () => {}, choose: async () => undefined, input: async () => undefined, confirm: async () => false, openLink: async () => {}, copy: async () => {} };
  const session = new PiSession(rpc, ui);
  session.state.sessionUnavailable = false;
  const respond = (success: boolean, data?: unknown) => rpc.receive({ kind: 'rpc', value: { type: 'response', id: sent.at(-1)!.id, success, data } });
  return { session, rpc, sent, published, respond };
}

test('submissions always include steering fallback and wait for Pi acknowledgement', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'prompt', id: 's1', text: 'hello' });
  assert.equal(f.sent[0].streamingBehavior, 'steer');
  assert.equal(f.published.filter(m => m.type === 'submissionReceipt').length, 0);
  f.respond(true); await pending;
  assert.equal(f.published.at(-1)?.outcome, 'accepted');
  f.rpc.disconnect('done');
});

test('unavailable, blocking compaction, duplicate and unsupported submissions never go to Pi', async () => {
  const f = fixture();
  f.session.state.sessionUnavailable = true;
  await f.session.handle({ type: 'prompt', id: 's1', text: 'hello' });
  f.session.state.sessionUnavailable = false;
  f.session.state.compacting = true;
  await f.session.handle({ type: 'prompt', id: 's2', text: 'hello' });
  f.session.state.compacting = false;
  await f.session.handle({ type: 'prompt', id: 's3', text: '/delete' });
  assert.equal(f.sent.length, 0);
  assert.equal(f.published.filter(m => m.outcome === 'rejected').length, 3);
  const pending = f.session.handle({ type: 'prompt', id: 's5', text: 'one' });
  await f.session.handle({ type: 'prompt', id: 's6', text: 'two' });
  assert.equal(f.sent.length, 1);
  f.respond(true); await pending; f.rpc.disconnect('done');
});

test('manual compaction uses Pi RPC only while idle and retains optional instructions', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'compact', id: 'compact-1', customInstructions: 'Keep the implementation details.' });
  assert.deepEqual(f.sent[0], { id: 'nimrod-1', type: 'compact', customInstructions: 'Keep the implementation details.' });
  await f.session.handle({ type: 'compact', id: 'compact-2' });
  assert.equal(f.sent.length, 1);
  f.respond(true); await pending;
  assert.equal(f.published.at(-1)?.outcome, 'accepted');
  f.rpc.disconnect('done');
});

test('disconnect reports unknown acceptance, not a rejected or replayed prompt', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'prompt', id: 's1', text: 'hello' });
  f.rpc.disconnect('closed'); await pending;
  assert.equal(f.published.at(-1)?.outcome, 'unknown');
  assert.equal(f.sent.length, 1);
  assert.equal(f.session.state.sessionUnavailable, true);
});

test('stop restores the authoritative cleared queue before abort', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'stop' });
  assert.equal(f.sent[0].type, 'clear_queue');
  f.respond(true, { steering: ['keep me'], followUp: [] });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.published.at(-1)?.type, 'queueRecovery');
  assert.deepEqual(f.published.at(-1)?.steering, ['keep me']);
  assert.equal(f.sent[1].type, 'abort');
  f.respond(true); await pending; f.rpc.disconnect('done');
});

test('agent_end does not release active state; only settled does', () => {
  const f = fixture();
  f.rpc.receive({ kind: 'rpc', value: { type: 'agent_start' } });
  f.rpc.receive({ kind: 'rpc', value: { type: 'agent_end' } });
  assert.equal(f.session.state.busy, true);
  f.rpc.receive({ kind: 'rpc', value: { type: 'agent_settled' } });
  assert.equal(f.session.state.busy, false);
  f.rpc.disconnect('done');
});
