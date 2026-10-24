import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexSession } from '../src/codex/session';
import type { CodexPacket } from '../src/codex/protocol';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import { codexScope, codexSessionLifecycle } from '../src/codex/session-lifecycle';
import { readSavedSidebarSession } from '../src/session-lifecycle';
import { savedSessionKey } from '../src/session-list';
import { pluginTargets } from '../src/card-plugin-targets';

const cwd = '/fixture/codex';
const thread = () => ({ id: 'thread', cwd, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'idle' } });
const model = { model: 'fixture-model', displayName: 'Fixture model', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }], inputModalities: ['text', 'image'] };
const turn = (status = 'inProgress') => ({ id: 'turn', status, items: [], itemsView: 'full' });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(custom?: (packet: CodexPacket, reply: (result: unknown) => void, session: CodexSession) => boolean) {
  const sent: CodexPacket[] = [], publications: ConversationViewMessage[] = [], notices: string[] = [], completions: boolean[] = [], ids: string[] = [];
  let session!: CodexSession;
  const event = (method: string, params: Record<string, unknown>) => session.receive({ method, params: { threadId: 'thread', ...params } });
  session = new CodexSession({ write: packet => {
    sent.push(packet); const reply = (result: unknown) => session.receive({ id: packet.id, result });
    if (custom?.(packet, reply, session)) return;
    if (packet.method === 'initialized') return;
    const params = packet.params as Record<string, unknown>;
    switch (packet.method) {
      case 'initialize': reply({ userAgent: 'fixture/0.162.0' }); break;
      case 'thread/start': case 'thread/resume': reply({ cwd, thread: thread(), model: params.model ?? 'fixture-model', reasoningEffort: (params.config as Record<string, unknown> | undefined)?.model_reasoning_effort ?? 'low' }); break;
      case 'thread/turns/list': reply({ data: [], nextCursor: null }); break;
      case 'model/list': reply({ data: [model], nextCursor: null }); break;
      case 'turn/start':
        event('turn/started', { turn: turn() });
        event('item/started', { turnId: 'turn', item: { type: 'userMessage', id: 'user', clientId: params.clientUserMessageId, content: params.input } });
        reply({ turn: turn() }); break;
      case 'turn/steer': reply({ turnId: 'turn' }); break;
      case 'turn/interrupt': reply({}); break;
      default: throw new Error(`Unexpected fixture method ${String(packet.method)}`);
    }
  } }, {
    publish: message => publications.push(message), changed() {}, notice: message => notices.push(message), identified: id => ids.push(id),
    approval: async () => 'decline', disconnected() {}, completed: failed => completions.push(failed),
  });
  return { session, sent, publications, notices, completions, ids, event };
}

test('Codex creates without prompting, exposes advertised configuration/images and preserves tagged identity', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  assert.deepEqual(f.ids, ['thread']); assert.equal(f.session.state.sessionUnavailable, false);
  assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
  assert.ok(f.session.messageInput.capabilities().images);
  assert.equal(f.session.configuration.get('model'), 'fixture-model');
  assert.deepEqual(f.session.configuration.capabilities.map(setting => setting.id), ['model', 'effort']);
  const owner = { starting: false, ended: false };
  const backend = { session: f.session, savedSessionId: 'thread' };
  const lifecycle = codexSessionLifecycle(() => owner, backend, { connect: async () => {}, stop: async () => {}, gate: () => 'ready' });
  assert.deepEqual(lifecycle.identity, { kind: 'codex', sessionId: 'thread' });
  assert.equal(lifecycle.draftScope, codexScope('thread'));
  assert.notEqual(savedSessionKey(lifecycle.identity!), savedSessionKey({ kind: 'copilot-sdk', sessionId: 'thread' }));
  assert.deepEqual(readSavedSidebarSession({ kind: 'codex', sessionId: 'thread', name: 'Saved', pinned: true, lastUsed: 1 }), { kind: 'codex', sessionId: 'thread', name: 'Saved', pinned: true, lastUsed: 1 });
  f.session.disconnect('done');
});

test('Codex user clientId reconciles local preview, streamed rows retain keys and completion uses full lifecycle publication', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  await f.session.messageInput.submit({ id: 'submission', text: 'hello', mode: 'normal' });
  assert.equal(f.session.state.messages.filter(row => row.role === 'user').length, 1);
  assert.equal(f.session.state.messages[0].key, 'codex:local:submission');
  f.event('item/started', { turnId: 'turn', item: { id: 'assistant', type: 'agentMessage', text: '' } });
  f.event('item/agentMessage/delta', { turnId: 'turn', itemId: 'assistant', delta: 'hello' });
  const row = f.session.state.messages.at(-1)!; const status = f.session.state.statusArea;
  f.event('item/agentMessage/delta', { turnId: 'turn', itemId: 'assistant', delta: ' world' });
  assert.equal(f.session.state.messages.at(-1)!.key, row.key); assert.equal(f.session.state.statusArea, status);
  f.event('turn/completed', { turn: turn('completed') });
  assert.equal(f.session.state.busy, false); assert.equal(f.session.state.messages.at(-1)!.streaming, false);
  assert.equal(f.publications.at(-1)?.transcript?.rows, undefined, 'completion cannot claim unchanged rows');
  assert.deepEqual(f.completions, [false]);
  assert.ok(f.publications.some(message => message.type === 'submissionReceipt' && message.id === 'submission' && message.outcome === 'accepted'));
  f.session.disconnect('done');
});

test('Codex tools retain immutable input identity across output-only deltas and use native source', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  f.event('item/started', { turnId: 'turn', item: { id: 'command', type: 'commandExecution', command: 'echo fixture', cwd, status: 'inProgress', aggregatedOutput: '' } });
  const first = f.session.state.messages.at(-1)!;
  f.event('item/commandExecution/outputDelta', { turnId: 'turn', itemId: 'command', delta: 'fixture\n' });
  const next = f.session.state.messages.at(-1)!;
  assert.equal(next.toolArguments, first.toolArguments); assert.ok(Object.isFrozen(next.toolNative));
  assert.deepEqual(next.toolSource, { backend: 'codex', agent: 'codex' }); assert.equal(next.output, 'fixture\n');
  assert.equal(next.key, first.key); assert.equal(next.toolStatus, 'running');
  f.event('item/completed', { turnId: 'turn', item: { id: 'command', type: 'commandExecution', command: 'echo fixture', cwd, status: 'completed', aggregatedOutput: 'fixture\n' } });
  assert.equal(f.session.state.messages.at(-1)!.toolStatus, 'result'); f.session.disconnect('done');
});

test('Codex history hydration does not overwrite live rows or the native delta base', async () => {
  const f = fixture((packet, reply, session) => {
    if (packet.method === 'thread/resume') {
      reply({ cwd, thread: thread(), model: 'fixture-model', reasoningEffort: 'low' });
      session.receive({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { id: 'assistant', type: 'agentMessage', text: 'live' } } }); return true;
    }
    if (packet.method === 'thread/turns/list') { reply({ data: [{ ...turn('completed'), items: [{ id: 'assistant', type: 'agentMessage', text: 'old' }] }], nextCursor: null }); return true; }
    return false;
  });
  await f.session.initialize(cwd, 'thread');
  f.event('item/agentMessage/delta', { turnId: 'turn', itemId: 'assistant', delta: '+' });
  assert.deepEqual(f.session.state.messages.at(-1)!.content, [{ type: 'text', text: 'live+' }]); f.session.disconnect('done');
});

test('Codex applies advertised effort through result-confirmed configuration without a prompt', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  const choices = await f.session.configuration.choices('effort');
  f.session.configuration.set('effort', choices.find(choice => choice.value === 'high')!);
  await flush();
  assert.equal(f.session.configuration.get('effort'), 'high');
  assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
  assert.equal(f.session.configuration.operations.at(-1)?.phase, 'completed'); f.session.disconnect('done');
});

test('Codex exposes text steering and cancellation, but never falls back to a follow-up prompt', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  await f.session.messageInput.submit({ id: 'a', text: 'first', mode: 'normal' });
  await f.session.messageInput.submit({ id: 'b', text: 'steer', mode: 'steer' });
  assert.equal(f.sent.filter(packet => packet.method === 'turn/start').length, 1);
  assert.equal(f.sent.filter(packet => packet.method === 'turn/steer').length, 1);
  await f.session.messageInput.submit({ id: 'c', text: 'queue', mode: 'followUp' });
  assert.ok(f.publications.some(message => message.id === 'c' && message.outcome === 'rejected'));
  await f.session.handle({ type: 'stop' }); assert.equal(f.session.state.busy, true);
  f.event('turn/completed', { turn: turn('interrupted') }); assert.equal(f.session.state.status, 'Stopped');
  assert.deepEqual(f.completions, []); f.session.disconnect('done');
});

test('Codex rejects slash commands and capability-unsupported images before transport work', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  await f.session.messageInput.submit({ id: 'slash', text: '/model', mode: 'normal' });
  assert.ok(f.publications.some(message => message.id === 'slash' && message.outcome === 'rejected'));
  assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
  f.session.disconnect('done'); assert.equal(f.session.messageInput.capabilities().images, undefined);
});

test('Codex native turn errors remain harness transcript records, not fake user prompts', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  await f.session.messageInput.submit({ id: 'a', text: 'first', mode: 'normal' });
  f.event('turn/completed', { turn: { ...turn('failed'), error: { message: 'fixture provider failure' } } });
  assert.equal(f.session.state.messages.at(-1)?.role, 'error'); assert.deepEqual(f.completions, [true]);
  assert.deepEqual(f.notices, []); f.session.disconnect('done');
});

test('Codex is a distinct card-plugin target, not a synthetic Pi/ACP tool', () => {
  assert.deepEqual(pluginTargets([{ backend: 'codex', agent: 'codex' }]), [{ backend: 'codex', agent: 'codex' }]);
});
