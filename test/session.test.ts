import assert from 'node:assert/strict';
import test from 'node:test';
import { PiSession, type SessionUi } from '../src/pi/session';
import { PiTransport } from '../src/pi/transport';
import type { JsonRecord } from '../src/pi/types';
import type { HostMessage } from '../src/pi/webview-client';

function fixture() {
  const sent: JsonRecord[] = [], published: HostMessage[] = [];
  const attention: string[] = [];
  const previews: (string | undefined)[] = [];
  const usage = { acceptedPrompts: 0 };
  const rpc = new PiTransport(async message => { sent.push(message); });
  const ui: SessionUi = { promptAccepted: () => { usage.acceptedPrompts++; }, attention: (kind, response) => { attention.push(kind); previews.push(response); }, publish: m => published.push(m), changed: () => {}, choose: async () => undefined, input: async () => undefined, confirm: async () => false, openLink: async () => {}, copy: async () => {} };
  const session = new PiSession(rpc, ui);
  session.state.sessionUnavailable = false;
  const respond = (success: boolean, data?: unknown) => rpc.receive({ kind: 'rpc', value: { type: 'response', id: sent.at(-1)!.id, success, data } });
  return { session, rpc, sent, published, respond, attention, previews, ui, usage };
}

test('ordinary submissions include steering fallback and wait for Pi acknowledgement', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'prompt', id: 's1', text: 'hello' });
  assert.equal(f.sent[0].streamingBehavior, 'steer');
  assert.equal(f.usage.acceptedPrompts, 0);
  assert.equal(f.published.filter(m => m.type === 'submissionReceipt').length, 0);
  f.respond(true); await pending;
  assert.equal(f.published.at(-1)?.outcome, 'accepted');
  assert.equal(f.usage.acceptedPrompts, 1);
  f.rpc.disconnect('done');
});

test('rename acknowledgement updates the name and composer receipt but never prompt recency', async () => {
  for (const text of ['/name Inline name', '/name']) {
    const f = fixture();
    f.ui.input = async () => 'Dialog name';
    const pending = f.session.handle({ type: 'prompt', id: 'rename', text });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(f.sent[0].type, 'set_session_name');
    assert.equal(f.usage.acceptedPrompts, 0);
    f.respond(true); await pending;
    assert.equal(f.session.state.sessionName, text === '/name' ? 'Dialog name' : 'Inline name');
    assert.equal(f.published.at(-1)?.outcome, 'accepted');
    assert.equal(f.usage.acceptedPrompts, 0, 'accepted metadata is not a sent prompt');
    const message = f.session.handle({ type: 'prompt', id: 'message', text: 'Actual message after rename' });
    assert.equal(f.sent.at(-1)?.type, 'prompt');
    f.respond(true); await message;
    assert.equal(f.usage.acceptedPrompts, 1, 'the next actual prompt still advances recency');
    f.rpc.disconnect('done');
  }
});

test('canceled, rejected and uncertain renames never advance prompt recency', async () => {
  for (const outcome of ['cancelled', 'rejected', 'unknown']) {
    const f = fixture();
    const pending = f.session.handle({ type: 'prompt', id: 'rename', text: outcome === 'cancelled' ? '/name' : '/name Changed' });
    if (outcome === 'rejected') f.respond(false);
    if (outcome === 'unknown') f.rpc.disconnect('Lost rename acknowledgement');
    await pending;
    assert.equal(f.published.at(-1)?.outcome, outcome);
    assert.equal(f.usage.acceptedPrompts, 0);
    f.rpc.disconnect('done');
  }
});

test('explicit queue submissions use followUp only while the main agent is working', async () => {
  for (const busy of [true, false]) {
    const f = fixture();
    f.session.state.busy = busy;
    const pending = f.session.handle({ type: 'prompt', id: 'queued', text: 'next task', mode: 'followUp' });
    assert.equal(f.sent[0].streamingBehavior, busy ? 'followUp' : 'steer');
    assert.equal(f.published.filter(m => m.type === 'submissionReceipt').length, 0);
    assert.equal(f.usage.acceptedPrompts, 0);
    f.respond(true); await pending;
    assert.equal(f.published.at(-1)?.outcome, 'accepted');
    assert.equal(f.usage.acceptedPrompts, 1);
    f.rpc.disconnect('done');
  }
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
  assert.equal(f.usage.acceptedPrompts, 0, 'accepted compaction is not a sent prompt');
  f.rpc.disconnect('done');
});

test('disconnect reports unknown acceptance, not a rejected or replayed prompt', async () => {
  const f = fixture();
  const pending = f.session.handle({ type: 'prompt', id: 's1', text: 'hello' });
  f.rpc.disconnect('closed'); await pending;
  assert.equal(f.published.at(-1)?.outcome, 'unknown');
  assert.equal(f.sent.length, 1);
  assert.equal(f.session.state.sessionUnavailable, true);
  assert.equal(f.usage.acceptedPrompts, 0);
});

test('stop restores the authoritative cleared queue before abort', async () => {
  const f = fixture();
  f.rpc.receive({ kind: 'rpc', value: { type: 'agent_start' } });
  const pending = f.session.handle({ type: 'stop' });
  assert.equal(f.sent[0].type, 'clear_queue');
  f.respond(true, { steering: ['keep me'], followUp: [] });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.published.at(-1)?.type, 'queueRecovery');
  assert.deepEqual(f.published.at(-1)?.steering, ['keep me']);
  assert.equal(f.sent[1].type, 'abort');
  f.respond(true); await pending;
  f.rpc.receive({ kind: 'rpc', value: { type: 'agent_settled' } });
  assert.deepEqual(f.attention, []);
  f.rpc.disconnect('done');
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


test('attention comes from live settled runs, not history, intermediate turns or duplicate settled events', () => {
  const f = fixture();
  const emit = (type: string) => f.rpc.receive({ kind: 'rpc', value: { type } });
  emit('agent_settled');
  emit('agent_start'); emit('agent_end'); emit('auto_retry_start'); emit('auto_retry_end');
  assert.deepEqual(f.attention, []);
  emit('agent_settled'); emit('agent_settled');
  assert.deepEqual(f.attention, ['completed']);
  f.rpc.disconnect('done');
  assert.deepEqual(f.attention, ['completed', 'failed']);
  f.rpc.receive({ kind: 'rpc', value: { type: 'process_error' } });
  assert.deepEqual(f.attention, ['completed', 'failed']);
});

test('final failed runs notify once; aborted runs stay quiet; successful retries finish normally', () => {
  for (const [reasons, expected] of [
    [['error'], ['failed']], [['aborted'], []], [['error', 'stop'], ['completed']],
  ] as [string[], string[]][]) {
    const f = fixture();
    f.rpc.receive({ kind: 'rpc', value: { type: 'agent_start' } });
    for (const stopReason of reasons) f.rpc.receive({ kind: 'rpc', value: { type: 'message_end', message: { role: 'assistant', stopReason, content: [] } } });
    f.rpc.receive({ kind: 'rpc', value: { type: 'agent_end' } });
    assert.deepEqual(f.attention, []);
    f.rpc.receive({ kind: 'rpc', value: { type: 'agent_settled' } });
    assert.deepEqual(f.attention, expected);
    f.rpc.disconnect('done');
  }
});

test('completion previews use only the latest finalized assistant text and reset each run', () => {
  const f = fixture();
  const emit = (value: JsonRecord) => f.rpc.receive({ kind: 'rpc', value });
  emit({ type: 'agent_start' });
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier narration' }] } });
  emit({ type: 'message_end', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'Done.' },
    { type: 'toolCall', name: 'bash', arguments: { command: 'private tool' } }, { type: 'text', text: 'Tests passed.' },
  ] } });
  emit({ type: 'message_end', message: { role: 'user', content: 'private user prompt' } });
  assert.deepEqual(f.previews, []);
  emit({ type: 'agent_settled' });
  assert.deepEqual(f.previews, ['Done.\n\nTests passed.']);
  emit({ type: 'agent_start' }); emit({ type: 'agent_settled' });
  assert.deepEqual(f.previews, ['Done.\n\nTests passed.', undefined]);
  emit({ type: 'agent_start' });
  emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [{ type: 'text', text: 'private failure details' }] } });
  emit({ type: 'agent_settled' });
  assert.equal(f.attention.at(-1), 'failed'); assert.equal(f.previews.at(-1), undefined);
  f.rpc.disconnect('done');
});

test('only extension input requests generate attention, not ordinary extension notices', async () => {
  const f = fixture();
  f.rpc.receive({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', id: 'notice', message: 'private text' } });
  f.rpc.receive({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'input', id: 'input', title: 'Private title' } });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.attention, ['input']);
  f.rpc.disconnect('done');
});
