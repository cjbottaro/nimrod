import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexSession, type CodexSessionUi } from '../src/codex/session';
import type { TranscriptLogRecord } from '../src/transcript-logs';
import type { CodexPacket } from '../src/codex/protocol';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import { codexScope, codexSessionLifecycle } from '../src/codex/session-lifecycle';
import { readSavedSidebarSession } from '../src/session-lifecycle';
import { savedSessionKey } from '../src/session-list';
import { pluginTargets } from '../src/card-plugin-targets';
import { SessionDrafts } from '../src/session-drafts';
import { codexConnectionFailure } from '../src/codex/connection-failure';

const cwd = '/fixture/codex';
const thread = () => ({ id: 'thread', cwd, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'idle' } });
const model = { model: 'fixture-model', displayName: 'Fixture model', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }, { reasoningEffort: 'high', description: 'High' }], inputModalities: ['text', 'image'] };
const turn = (status = 'inProgress') => ({ id: 'turn', status, items: [], itemsView: 'full' });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(custom?: (packet: CodexPacket, reply: (result: unknown) => void, session: CodexSession) => boolean, ui: Partial<CodexSessionUi> = {}) {
  const sent: CodexPacket[] = [], publications: ConversationViewMessage[] = [], notices: string[] = [], completions: boolean[] = [], ids: string[] = [];
  let session!: CodexSession;
  const event = (method: string, params: Record<string, unknown>) => session.receive({ method, params: { threadId: 'thread', ...params } });
  session = new CodexSession({ write: packet => {
    sent.push(packet); const reply = (result: unknown) => session.receive({ id: packet.id, result });
    if (custom?.(packet, reply, session)) return;
    if (packet.method === 'initialized' || packet.method === undefined) return;
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
    approval: async () => 'decline', disconnected() {}, completed: failed => completions.push(failed), ...ui,
  });
  return { session, sent, publications, notices, completions, ids, event };
}

const asyncItem = (id = 'async-question') => ({ type: 'agentMessage', id, delivery: 'async', text: 'Which?\n- A\n- B', questions: [{ title: 'Which?', options: ['A', 'B'] }] });

test('Codex async questions survive completion, deduplicate terminal snapshots, and answer through idle turn/start', async () => {
  let answer!: (value: { answer: string; wasFreeform: boolean }) => void;
  let signal!: AbortSignal, calls = 0;
  const f = fixture(undefined, { asyncQuestion: (_question, owner) => { calls++; signal = owner; return new Promise(resolve => { answer = resolve; }); } });
  await f.session.initialize(cwd); await f.session.messageInput.submit({ id: 'start', text: 'Ask me', mode: 'normal' });
  f.event('item/completed', { turnId: 'turn', item: asyncItem() });
  f.event('turn/completed', { turn: { ...turn('completed'), items: [asyncItem()] } }); await flush();
  assert.equal(calls, 1); assert.equal(signal.aborted, false); assert.equal(f.session.state.busy, false);
  answer({ answer: 'B', wasFreeform: false }); await flush();
  const starts = f.sent.filter(packet => packet.method === 'turn/start'); assert.equal(starts.length, 2);
  const text = ((starts[1].params as any).input[0].text) as string;
  assert.match(text, /<send_user_message_question_reply>/); assert.match(text, /request_user_input_async/); assert.match(text, /"answer":"B"/);
  assert.equal(f.sent.some(packet => packet.method === 'turn/steer'), false);
  const latestUser = f.session.state.messages.filter(row => row.role === 'user').at(-1)!;
  assert.match(JSON.stringify(latestUser.content), /send_user_message_question_reply/, 'retain native structure for the integration-owned question/answer card');
  assert.match(JSON.stringify(latestUser.content), /Which\?/); f.session.disconnect('done');
});

test('Codex async answers steer active turns, while Ignore and ordinary follow-ups never send a fabricated answer', async () => {
  const pending: { signal: AbortSignal; resolve(value?: { answer: string; wasFreeform: boolean }): void }[] = [];
  const f = fixture(undefined, { asyncQuestion: (_question, signal) => new Promise(resolve => pending.push({ signal, resolve })) });
  await f.session.initialize(cwd); await f.session.messageInput.submit({ id: 'start', text: 'Ask me', mode: 'normal' });
  f.event('item/completed', { turnId: 'turn', item: asyncItem('steer') }); await flush();
  pending[0].resolve({ answer: 'A', wasFreeform: false }); await flush();
  assert.equal(f.sent.filter(packet => packet.method === 'turn/steer').length, 1);
  f.event('item/completed', { turnId: 'turn', item: asyncItem('ignore') }); await flush();
  const before = f.sent.length; pending[1].resolve(); await flush(); assert.equal(f.sent.length, before);
  f.event('item/completed', { turnId: 'turn', item: asyncItem('superseded') }); await flush();
  // A locally rejected slash command does not supersede an optional question.
  await f.session.messageInput.submit({ id: 'slash', text: '/nope', mode: 'normal' }); assert.equal(pending[2].signal.aborted, false);
  await f.session.messageInput.submit({ id: 'different', text: 'Never mind, do something else', mode: 'normal' });
  assert.equal(pending[2].signal.aborted, true);
  const after = f.sent.length; pending[2].resolve({ answer: 'late', wasFreeform: true }); await flush(); assert.equal(f.sent.length, after);
  f.event('item/completed', { turnId: 'turn', item: asyncItem('disconnected') }); await flush(); f.session.disconnect('done');
  assert.equal(pending[3].signal.aborted, true); pending[3].resolve({ answer: 'late', wasFreeform: true }); await flush(); assert.equal(f.sent.length, after);
});

test('Codex async answer delivery errors do not retry or invent a replacement turn', async () => {
  for (const outcome of ['rejected', 'unknown'] as const) {
    let starts = 0;
    const f = fixture((packet, _reply, session) => {
      if (packet.method !== 'turn/start' || ++starts !== 2) return false;
      if (outcome === 'rejected') session.receive({ id: packet.id, error: { code: -32000, message: 'fixture rejection' } });
      else session.disconnect('fixture lost answer connection');
      return true;
    }, { asyncQuestion: async () => ({ answer: 'A', wasFreeform: false }) });
    await f.session.initialize(cwd); await f.session.messageInput.submit({ id: 'start', text: 'Ask me', mode: 'normal' });
    f.event('item/completed', { turnId: 'turn', item: asyncItem() });
    f.event('turn/completed', { turn: turn('completed') }); await flush();
    assert.equal(starts, 2); assert.equal(f.sent.some(packet => packet.method === 'turn/steer'), false);
    assert.ok(f.publications.some(message => message.id?.startsWith('codex-answer:') && message.outcome === outcome));
    f.session.disconnect('done');
  }
});

test('Codex historical async questions render as history without reopening a stale picker', async () => {
  let calls = 0;
  const f = fixture((packet, reply) => {
    if (packet.method !== 'thread/turns/list') return false;
    reply({ data: [{ ...turn('completed'), items: [asyncItem()] }], nextCursor: null }); return true;
  }, { asyncQuestion: async () => { calls++; return undefined; } });
  await f.session.initialize(cwd, 'thread'); await flush(); assert.equal(calls, 0);
  assert.match(JSON.stringify(f.session.state.messages), /Which\?/); f.session.disconnect('done');
});

test('observed 0.164 startup binds the actual shared draft store before reading models', async () => {
  const staged: string[] = [];
  const drafts = new SessionDrafts(undefined, undefined, () => {}, key => staged.push(key));
  drafts.select('unassigned:new-codex'); drafts.write({ draft: 'Do not send this draft' });
  const f = fixture((packet, reply, session) => {
    if (packet.method === 'initialize') { reply({ userAgent: 'nimrod/0.164.0 fixture', platformFamily: 'unix', platformOs: 'macos' }); return true; }
    if (packet.method !== 'thread/start') return false;
    const nativeThread = { ...thread(), cliVersion: '0.164.0', source: 'vscode', originator: 'nimrod', forkedFromId: null, canAcceptDirectInput: true };
    reply({ cwd, thread: nativeThread, model: 'fixture-model', reasoningEffort: 'low', activePermissionProfile: { id: ':read-only', extends: null }, approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } });
    session.receive({ method: 'thread/started', params: { thread: nativeThread } });
    session.receive({ method: 'mcpServer/startupStatus/updated', params: { threadId: 'thread', name: 'fixture', status: 'starting', error: null } });
    return true;
  }, { identified: id => drafts.bindScope(codexScope(id)) });
  await f.session.initialize(cwd);
  assert.equal(f.session.state.sessionUnavailable, false); assert.equal(f.session.client.threadId, 'thread');
  assert.deepEqual(drafts.read(), { draft: 'Do not send this draft' });
  assert.ok(staged.includes(codexScope('thread'))); assert.ok(f.sent.some(packet => packet.method === 'model/list'));
  assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
  assert.deepEqual(f.sent.find(packet => packet.method === 'thread/start')!.params, { cwd, ephemeral: false });
  f.session.disconnect('done');
});

test('startup and cleanup diagnostics preserve the first failure and log both on the same connection', async () => {
  const logs: TranscriptLogRecord[] = [];
  const f = fixture(undefined, { identified: () => { throw new Error('Local identity binding failed'); },
    transcriptLog: { enabled: true, append: record => logs.push(structuredClone(record)) } });
  await assert.rejects(f.session.initialize(cwd), /Local identity binding failed/);
  const cleanup = new Error('Could not send SIGTERM to owned process group 42: EPERM; reservation retained');
  f.session.recordCleanupFailure(cleanup);
  const first = logs.find(record => record.event === 'connection.disconnected')!;
  const last = logs.find(record => record.event === 'connection.cleanup_failed')!;
  assert.equal(first.connectionId, last.connectionId);
  assert.deepEqual(first.payload, { error: 'Local identity binding failed' });
  assert.deepEqual(last.payload, { error: cleanup.message });
  const notice = codexConnectionFailure('Local identity binding failed', true, cleanup);
  assert.match(notice.message, /startup failed: Local identity binding failed/); assert.doesNotMatch(notice.message, /EPERM/);
  assert.match(notice.details!, /EPERM/); assert.match(notice.details!, /ownership remains reserved/);
  assert.equal(f.sent.filter(packet => packet.method === 'thread/start').length, 1);
  assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
});

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

test('Codex terminal delivery during hydration cannot revive stale history spinners', async () => {
  const f = fixture((packet, reply, session) => {
    if (packet.method !== 'thread/turns/list') return false;
    session.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: turn('interrupted') } });
    reply({ data: [{ ...turn(), items: [{ id: 'old-tool', type: 'commandExecution', command: 'fixture', cwd, status: 'inProgress', aggregatedOutput: 'partial' }] }], nextCursor: null });
    return true;
  });
  await f.session.initialize(cwd, 'thread');
  const row = f.session.state.messages.at(-1)!;
  assert.equal(row.streaming, false); assert.equal(row.uiPhase, 'stopped'); assert.equal(f.session.state.busy, false);
  f.session.disconnect('done');
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

test('Codex logs raw experimental requests/replies and surfaces unsupported interactions without a grant', async () => {
  const logs: TranscriptLogRecord[] = [];
  const f = fixture(undefined, { transcriptLog: { enabled: true, append: value => logs.push(structuredClone(value)) },
    question: async () => ({ scope: { answers: ['A'] } }) });
  await f.session.initialize(cwd); await f.session.messageInput.submit({ id: 'start', text: 'fixture', mode: 'normal' });
  const params = { threadId: 'thread', turnId: 'turn', itemId: 'input', isBlocking: true, autoResolutionMs: null,
    questions: [{ id: 'scope', header: 'Scope', question: 'Which?', isSecret: false, isOther: false, options: [{ label: 'A', description: 'Local' }] }] };
  f.session.receive({ id: 'input', method: 'item/tool/requestUserInput', params }); await flush();
  assert.ok(logs.some(log => log.event === 'receive' && (log.payload as Record<string, unknown>).method === 'item/tool/requestUserInput'));
  assert.ok(logs.some(log => log.event === 'response' && (log.payload as Record<string, unknown>).id === 'input'));
  f.session.receive({ id: 'unknown', method: 'future/interaction', params: { preserve: 'raw data' } }); await flush();
  assert.ok(f.notices.some(message => /future\/interaction/.test(message) && /No answer or approval/.test(message)));
  assert.ok(logs.some(log => log.event === 'interaction.rejected' && (log.payload as Record<string, unknown>).requestId === 'unknown'));
  assert.ok(f.sent.find(packet => packet.id === 'unknown')?.error);
  assert.equal(f.session.state.messages.some(row => row.role === 'user' && row.content === 'A'), false, 'answers are RPC responses, not replayed prompts');
  f.session.disconnect('done');
});

test('Codex is a distinct card-plugin target, not a synthetic Pi/ACP tool', () => {
  assert.deepEqual(pluginTargets([{ backend: 'codex', agent: 'codex' }]), [{ backend: 'codex', agent: 'codex' }]);
});
