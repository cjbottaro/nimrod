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
      case 'thread/settings/update':
        event('thread/settings/updated', { threadSettings: { cwd, model: params.model ?? 'fixture-model', effort: params.effort ?? 'low' } });
        reply({}); break;
      case 'thread/turns/list': reply({ data: [], nextCursor: null }); break;
      case 'model/list': reply({ data: [model], nextCursor: null }); break;
      case 'thread/read': reply({ thread: { ...thread(), name: 'Fixture thread', model: 'fixture-model', reasoningEffort: 'low' } }); break;
      case 'mcpServerStatus/list': case 'thread/backgroundTerminals/list': reply({ data: [], nextCursor: null }); break;
      case 'skills/list': reply({ data: [{ cwd, skills: [], errors: [] }] }); break;
      case 'hooks/list': reply({ data: [{ cwd, hooks: [], warnings: [], errors: [] }] }); break;
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

test('native saved-history evidence is separate from zero-message readiness and rename intent', async () => {
  let persisted = false, confirmations = 0;
  const f = fixture((packet, reply, session) => {
    if (packet.method === 'thread/turns/list' && !persisted) {
      session.receive({ id: packet.id, error: { code: -32600, message: 'thread/turns/list is unavailable before first user message' } });
      return true;
    }
    if (packet.method === 'thread/name/set') { persisted = true; reply({}); return true; }
    return false;
  }, { historyConfirmed: () => { confirmations++; } });
  try {
    await f.session.initialize(cwd); await flush();
    assert.equal(f.session.state.sessionUnavailable, false);
    assert.equal(confirmations, 0);
    assert.deepEqual(f.notices, [], 'an unavailable optional history read is not a startup error');
    await f.session.rename('User-chosen native name'); await flush();
    assert.equal(confirmations, 1, 'saved history is confirmed by its successful read, not the name alone');
    assert.equal(f.session.state.messages.some(row => row.role === 'user'), false);
    assert.equal(f.sent.some(packet => ['turn/start', 'turn/steer', 'thread/compact/start'].includes(String(packet.method))), false);
  } finally { f.session.disconnect('done'); }
});

test('a new Codex session can change model before any rollout exists', async () => {
  const other = { ...model, model: 'other-model', displayName: 'Other model' };
  const f = fixture((packet, reply, session) => {
    if (packet.method === 'thread/turns/list') {
      session.receive({ id: packet.id, error: { code: -32600, message: 'no rollout found for thread id thread' } }); return true;
    }
    if (packet.method === 'model/list') { reply({ data: [model, other], nextCursor: null }); return true; }
    if (packet.method === 'thread/resume') throw new Error('Fresh-thread configuration must not resume');
    return false;
  });
  try {
    await f.session.initialize(cwd); await flush();
    const choices = await f.session.configuration.choices('model');
    f.session.configuration.set('model', choices.find(choice => choice.value === other.model)!);
    await flush();
    assert.equal(f.session.configuration.get('model'), other.model);
    assert.equal(f.session.configuration.operations.at(-1)?.phase, 'completed');
    assert.equal(f.session.state.sessionUnavailable, false);
    assert.equal(f.sent.filter(packet => packet.method === 'thread/start').length, 1);
    assert.equal(f.sent.some(packet => ['thread/resume', 'turn/start', 'thread/name/set'].includes(String(packet.method))), false);
    assert.deepEqual(f.notices, []);
  } finally { f.session.disconnect('done'); }
});

test('native terminal events can confirm saved history without replaying or rehydrating the live transcript', async () => {
  let persisted = false, confirmations = 0;
  const f = fixture((packet, _reply, session) => {
    if (packet.method === 'thread/turns/list' && !persisted) {
      session.receive({ id: packet.id, error: { code: -32600, message: 'thread/turns/list is unavailable before first user message' } });
      return true;
    }
    return false;
  }, { historyConfirmed: () => { confirmations++; } });
  try {
    await f.session.initialize(cwd); await flush();
    await f.session.messageInput.submit({ id: 'one', text: 'Fixture input', mode: 'normal' });
    const before = f.session.state.messages;
    persisted = true; f.event('turn/completed', { turn: turn('completed') }); await flush();
    assert.equal(confirmations, 1);
    assert.equal(f.sent.filter(packet => packet.method === 'turn/start').length, 1);
    assert.equal(f.session.state.messages.length, before.length);
    assert.equal(f.session.state.messages.filter(row => row.role === 'user').length, 1);
  } finally { f.session.disconnect('done'); }
});

test('native Codex rename is exact-thread, ordered and does not overwrite newer title events', async () => {
  let reply!: (result: unknown) => void;
  const f = fixture((packet, respond) => {
    if (packet.method !== 'thread/name/set') return false;
    reply = respond; return true;
  });
  try {
    await f.session.initialize(cwd);
    const renaming = f.session.rename('  Named thread  ');
    assert.deepEqual(f.sent.at(-1)!.params, { threadId: 'thread', name: 'Named thread' });
    reply({}); assert.equal(f.session.state.sessionName, 'Named thread');
    f.event('thread/name/updated', { threadName: 'Newer name' });
    await renaming; assert.equal(f.session.state.sessionName, 'Newer name');
    const again = f.session.rename('Another name');
    f.event('thread/name/updated', { threadName: 'Authoritative event' }); reply({}); await again;
    assert.equal(f.session.state.sessionName, 'Authoritative event');
    const failed = f.session.rename('Rejected');
    f.session.receive({ id: f.sent.at(-1)!.id, error: { code: -32601, message: 'Rename unsupported' } });
    await assert.rejects(failed, /Rename unsupported/);
    assert.equal(f.session.state.sessionName, 'Authoritative event');
    assert.equal(f.sent.some(packet => ['turn/start', 'turn/steer'].includes(String(packet.method))), false);
  } finally { f.session.disconnect('done'); }
});

test('Codex command catalog and model picker use native configuration, not prompts or Nimrod actions', async () => {
  const f = fixture(undefined, { commandInteraction: {
    async choice(title, choices) { assert.equal(title, 'Codex /model'); return choices[0].id; }, async input() { return undefined; },
  } });
  try {
    await f.session.initialize(cwd);
    assert.deepEqual(f.session.slashCommands.catalog().commands.map(command => command.name), ['model', 'rename', 'compact', 'status', 'pwd', 'ps', 'skills', 'hooks']);
    const commands = f.session.slashCommands;
    await commands.invoke({ id: 'model', text: '/model' });
    assert.equal(commands.operations.at(-1)?.phase, 'completed');
    assert.equal(f.session.configuration.get('model'), 'fixture-model');
    assert.equal(f.sent.filter(packet => packet.method === 'thread/settings/update').length, 1);
    assert.equal(f.sent.some(packet => packet.method === 'thread/resume'), false);
    assert.equal(f.sent.some(packet => ['turn/start', 'turn/steer'].includes(String(packet.method))), false);
    assert.equal(f.session.state.messages.length, 0);
    assert.match(commands.validate('/model nonexistent')!, /advertised/);
    assert.match(commands.validate('/compact focus')!, /does not accept arguments/);
    assert.match(commands.validate('/permissions')!, /not supported/);
    assert.equal(commands.validate('/model fixture-model '), undefined, 'Tab completion adds a trailing space');
  } finally { f.session.disconnect('done'); }
});
test('Codex rename command waits for terminal idle, confirms its native name and keeps one card', async () => {
  const f = fixture((packet, reply) => { if (packet.method !== 'thread/name/set') return false; reply({}); return true; });
  try {
    await f.session.initialize(cwd); f.event('turn/started', { turn: turn() });
    const running = f.session.slashCommands.invoke({ id: 'rename', text: '/rename Command name' });
    const key = f.session.slashCommands.operations.at(-1)!.key;
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'queued');
    assert.equal(f.sent.some(packet => packet.method === 'thread/name/set'), false);
    f.event('turn/completed', { turn: turn('completed') }); await running;
    assert.equal(f.session.state.sessionName, 'Command name');
    assert.equal(f.session.slashCommands.operations.at(-1)?.key, key);
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'completed');
    assert.equal(f.sent.filter(packet => packet.method === 'thread/name/set').length, 1);
    assert.equal(f.sent.some(packet => ['turn/start', 'turn/steer'].includes(String(packet.method))), false);
  } finally { f.session.disconnect('done'); }
});
test('Codex command picker cancellation and stale model choice never dispatch a mutation', async () => {
  for (const selection of [undefined, 'revoked-model']) {
    const f = fixture(undefined, { commandInteraction: { choice: async () => selection, input: async () => undefined } });
    try {
      await f.session.initialize(cwd); await f.session.slashCommands.invoke({ id: 'cancel', text: '/model' });
      assert.equal(f.sent.some(packet => packet.method === 'thread/resume'), false);
      assert.equal(f.session.slashCommands.operations.at(-1)?.phase, selection === undefined ? undefined : 'failed');
      assert.equal(f.notices.length, 0, 'the command card owns errors');
    } finally { f.session.disconnect('done'); }
  }
});
test('Codex command disconnect after mutation dispatch reports uncertainty and never retries', async () => {
  const f = fixture((packet, _reply, session) => {
    if (packet.method !== 'thread/name/set') return false;
    queueMicrotask(() => session.disconnect('Lost command response')); return true;
  });
  await f.session.initialize(cwd); await f.session.slashCommands.invoke({ id: 'unknown', text: '/rename Unconfirmed' });
  assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'unknown');
  assert.equal(f.sent.filter(packet => packet.method === 'thread/name/set').length, 1);
});

for (const command of ['status', 'pwd', 'cwd', 'ps', 'skills', 'hooks']) test(`Codex /${command} uses scoped read-only native APIs and one Command card during work`, async () => {
  const f = fixture();
  try {
    await f.session.initialize(cwd); f.event('turn/started', { turn: turn() });
    const before = f.session.state.messages;
    await f.session.slashCommands.invoke({ id: command, text: `/${command}` });
    const operation = f.session.slashCommands.operations.at(-1)!;
    assert.equal(operation.phase, 'completed'); assert.ok(operation.commandOutput?.length);
    assert.equal(f.session.state.busy, true); assert.equal(f.session.state.messages, before);
    assert.equal(f.sent.some(packet => ['turn/start', 'turn/steer', 'thread/compact/start'].includes(String(packet.method))), false);
    if (command === 'skills' || command === 'hooks') assert.deepEqual(f.sent.at(-1)!.params, { cwds: [cwd] });
    else assert.equal((f.sent.at(-1)!.params as Record<string, unknown>).threadId, 'thread');
    if (command === 'cwd' || command === 'pwd') assert.equal(operation.commandOutput![0].text, cwd);
    assert.deepEqual(f.completions, []); assert.deepEqual(f.notices, []);
  } finally { f.session.disconnect('done'); }
});
test('Codex rejects unsupported report arguments and mutation variants before invocation', async () => {
  const f = fixture();
  try {
    await f.session.initialize(cwd); const count = f.sent.length;
    for (const text of ['/mcp', '/mcp verbose', '/mcp login secret-server', '/skills enable all', '/hooks trust all', '/pwd elsewhere', '/compact focus', '/stop']) {
      assert.ok(f.session.slashCommands.validate(text));
      await assert.rejects(f.session.slashCommands.invoke({ id: text, text }));
    }
    assert.equal(f.sent.length, count);
  } finally { f.session.disconnect('done'); }
});
test('Codex report pagination rejects repeated cursors rather than settling a partial report', async () => {
  const f = fixture((packet, reply) => {
    if (packet.method !== 'mcpServerStatus/list') return false;
    reply({ data: [], nextCursor: 'repeat' }); return true;
  });
  try {
    await f.session.initialize(cwd);
    await assert.rejects(f.session.inspectMcp(() => true, true), /pagination cursor/);
    assert.deepEqual(f.session.slashCommands.operations, []);
    assert.equal(f.sent.filter(packet => packet.method === 'mcpServerStatus/list').length, 2);
  } finally { f.session.disconnect('done'); }
});
test('Codex project catalog reports reject cross-project native responses', async () => {
  const f = fixture((packet, reply) => {
    if (packet.method !== 'skills/list') return false;
    reply({ data: [{ cwd: '/another-project', skills: [], errors: [] }] }); return true;
  });
  try {
    await f.session.initialize(cwd); await f.session.slashCommands.invoke({ id: 'skills', text: '/skills' });
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'failed');
    assert.match(f.session.slashCommands.operations.at(-1)?.inlineError!, /different project/);
    assert.equal(f.notices.length, 0);
  } finally { f.session.disconnect('done'); }
});
for (const early of [false, true]) test(`Codex compaction waits for its canonical item and terminal turn, not RPC acknowledgement (early=${early})`, async () => {
  let acknowledge!: (value: unknown) => void;
  const f = fixture((packet, reply) => { if (packet.method !== 'thread/compact/start') return false; acknowledge = reply; return true; });
  try {
    await f.session.initialize(cwd);
    const running = f.session.slashCommands.invoke({ id: 'compact', text: '/compact' });
    const key = f.session.slashCommands.operations.at(-1)!.key;
    if (!early) { acknowledge({}); await flush(); }
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'applying');
    assert.equal(f.session.state.inputLocked, true);
    f.event('turn/started', { turn: turn() });
    f.event('item/completed', { turnId: 'turn', item: { id: 'compact-marker', type: 'contextCompaction' } });
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'applying');
    f.event('turn/completed', { turn: turn('completed') });
    if (early) acknowledge({}); await running;
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, 'completed');
    assert.equal(f.session.slashCommands.operations.at(-1)?.key, key);
    assert.equal(f.session.state.inputLocked, false); assert.equal(f.session.client.compacting, false);
    assert.equal(f.sent.filter(packet => packet.method === 'thread/compact/start').length, 1);
    assert.equal(f.sent.some(packet => packet.method === 'turn/start'), false);
    assert.equal(f.session.state.messages.length, 0); assert.deepEqual(f.completions, []);
  } finally { f.session.disconnect('done'); }
});
for (const outcome of ['failed', 'missing-marker', 'disconnected']) test(`Codex compaction ${outcome} retains an honest command outcome without replay`, async () => {
  const f = fixture((packet, reply) => { if (packet.method !== 'thread/compact/start') return false; reply({}); return true; });
  try {
    await f.session.initialize(cwd); const running = f.session.slashCommands.invoke({ id: 'compact', text: '/compact' });
    f.event('turn/started', { turn: turn() });
    if (outcome === 'disconnected') f.session.disconnect('Lost compaction connection');
    else f.event('turn/completed', { turn: { ...turn(outcome === 'failed' ? 'failed' : 'completed'), error: outcome === 'failed' ? { message: 'Fixture compaction failed' } : null } });
    await running;
    assert.equal(f.session.slashCommands.operations.at(-1)?.phase, outcome === 'failed' ? 'failed' : 'unknown');
    assert.equal(f.sent.filter(packet => packet.method === 'thread/compact/start').length, 1);
    assert.equal(f.session.state.messages.length, 0); assert.deepEqual(f.notices, []);
  } finally { f.session.disconnect('done'); }
});

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
  assert.match(notice.message, /startup failed/); assert.match(notice.details, /Local identity binding failed/); assert.doesNotMatch(notice.message, /EPERM/);
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

test('Codex applies advertised effort through native settings confirmation without a prompt', async () => {
  const f = fixture(); await f.session.initialize(cwd);
  const choices = await f.session.configuration.choices('effort');
  f.session.configuration.set('effort', choices.find(choice => choice.value === 'high')!);
  await flush();
  assert.equal(f.session.configuration.get('effort'), 'high');
  assert.deepEqual(f.sent.find(packet => packet.method === 'thread/settings/update')?.params, { threadId: 'thread', effort: 'high' });
  assert.equal(f.sent.some(packet => ['thread/resume', 'turn/start'].includes(String(packet.method))), false);
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
