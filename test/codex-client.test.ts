import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexClient, type CodexClientHooks } from '../src/codex/client';
import { RpcConnectionError, RpcResponseError } from '../src/json-rpc-connection';
import type { CodexPacket, CodexApprovalDecision } from '../src/codex/protocol';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const cwd = '/fixture/project';
const thread = (id = 'thread-a', directory = cwd) => ({ id, cwd: directory, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'idle' } });
const turn = (status = 'inProgress', id = 'turn-a') => ({ id, status, items: [], itemsView: 'full', error: null });
function fixture(hooks: CodexClientHooks = {}, timeoutMs = 20_000) {
  const sent: CodexPacket[] = [];
  const client = new CodexClient({ write: packet => { sent.push(packet); } }, hooks, timeoutMs);
  const last = (method: string) => {
    const found = [...sent].reverse().find(packet => packet.method === method);
    assert.ok(found, `Missing ${method}`); return found;
  };
  const respond = (method: string, result: unknown) => client.receive({ id: last(method).id, result });
  const event = (method: string, params: Record<string, unknown>, threadId = 'thread-a') => client.receive({ method, params: { threadId, ...params } });
  const initialize = async () => {
    const pending = client.initialize(); respond('initialize', { userAgent: 'codex/0.162.0' }); await pending;
  };
  const ready = async () => {
    await initialize(); const pending = client.open(cwd); respond('thread/start', { cwd, thread: thread() }); await pending;
  };
  const working = async () => {
    await ready(); const pending = client.startTurn('hello', 'client-a');
    event('turn/started', { turn: turn() }); respond('turn/start', { turn: turn() }); await pending;
  };
  return { client, sent, last, respond, event, initialize, ready, working };
}

test('Codex handshake omits the JSON-RPC version member and does not start work', async () => {
  const f = fixture(); const pending = f.client.initialize();
  assert.equal(f.client.phase, 'initializing');
  f.respond('initialize', { userAgent: 'codex/0.162.0' });
  assert.equal(f.client.phase, 'ready', 'response is applied synchronously');
  assert.deepEqual(f.sent.map(packet => packet.method), ['initialize', 'initialized']);
  assert.ok(f.sent.every(packet => !('jsonrpc' in packet)));
  assert.deepEqual((f.last('initialize').params as Record<string, unknown>).capabilities, { experimentalApi: false, requestAttestation: false });
  await pending;
  await assert.rejects(f.client.initialize(), /unavailable/);
  f.client.disconnect();
});

test('Codex binds exact project identity before releasing buffered events', async () => {
  const observed: string[] = [];
  const f = fixture({ identified: t => observed.push(`identity:${t.id}`), event: event => observed.push(event.method) });
  await f.initialize(); const pending = f.client.open(cwd);
  f.event('item/started', { turnId: 'turn-a', item: { id: 'item-a', type: 'agentMessage', text: '' } });
  f.event('item/started', {}, 'child-thread');
  assert.deepEqual(observed, []);
  f.respond('thread/start', { cwd, thread: thread() });
  assert.deepEqual(observed, ['identity:thread-a', 'item/started']);
  assert.equal(f.client.threadId, 'thread-a'); assert.equal(f.client.phase, 'idle');
  assert.deepEqual(f.last('thread/start').params, { cwd, ephemeral: false });
  await pending; f.client.disconnect();
});

test('Codex reentrant identity retirement cannot resurrect a disconnected connection', async () => {
  const f = fixture({ identified: () => { f.client.disconnect('Owner closed'); } });
  await f.initialize(); const pending = assert.rejects(f.client.open(cwd), RpcConnectionError);
  f.respond('thread/start', { cwd, thread: thread() }); await pending;
  assert.equal(f.client.phase, 'disconnected'); assert.equal(f.client.threadId, undefined);
});

test('Codex retirement during buffered replay suppresses remaining events', async () => {
  const seen: string[] = [];
  const f = fixture({ event: event => { seen.push(event.method); f.client.disconnect('Owner closed'); } });
  await f.initialize(); const pending = assert.rejects(f.client.open(cwd), RpcConnectionError);
  f.event('item/started', {}); f.event('item/completed', {});
  f.respond('thread/start', { cwd, thread: thread() }); await pending;
  assert.deepEqual(seen, ['item/started']); assert.equal(f.client.phase, 'disconnected');
});

test('Codex resume uses exact ID without prompt, history injection, or a replacement thread', async () => {
  const f = fixture(); await f.initialize(); const pending = f.client.open(cwd, 'saved');
  assert.deepEqual(f.last('thread/resume').params, { threadId: 'saved', cwd, excludeTurns: true });
  f.respond('thread/resume', { cwd, thread: thread('saved') }); await pending;
  assert.equal(f.sent.some(packet => ['thread/start', 'turn/start'].includes(String(packet.method))), false);
  f.client.disconnect();
});

test('Codex identity/project mismatch, ephemeral history and binding rejection fail closed', async () => {
  for (const scenario of ['id', 'cwd', 'outer-cwd', 'ephemeral', 'binding']) {
    const f = fixture({ identified: () => { if (scenario === 'binding') throw new Error('Draft scope conflict'); } });
    await f.initialize(); const pending = f.client.open(cwd, 'saved'); const checked = assert.rejects(pending);
    f.respond('thread/resume', { cwd: scenario === 'outer-cwd' ? '/other' : cwd,
      thread: { ...thread(scenario === 'id' ? 'other' : 'saved', scenario === 'cwd' ? '/other' : cwd), ephemeral: scenario === 'ephemeral' } });
    await checked; assert.equal(f.client.phase, 'disconnected');
    assert.equal(f.sent.filter(packet => packet.method === 'thread/resume').length, 1);
    assert.equal(f.sent.some(packet => packet.method === 'thread/start' || packet.method === 'turn/start'), false);
  }
});

test('Codex pre-identity event buffer is bounded by count and bytes', async () => {
  for (const oversized of [false, true]) {
    const f = fixture(); await f.initialize(); const pending = assert.rejects(f.client.open(cwd), /buffer exceeded/);
    if (oversized) f.event('item/agentMessage/delta', { delta: 'x'.repeat(1024 * 1024) });
    else for (let i = 0; i <= 128; i++) f.event('item/started', {});
    await pending; assert.equal(f.client.phase, 'disconnected');
  }
});

test('Codex start acknowledgement never overwrites newer completion or streamed content', async () => {
  const events: string[] = [];
  const f = fixture({ event: event => events.push(event.method) }); await f.ready();
  const pending = f.client.startTurn('hello', 'client-a');
  assert.deepEqual(f.last('turn/start').params, { threadId: 'thread-a', clientUserMessageId: 'client-a', input: [{ type: 'text', text: 'hello', text_elements: [] }] });
  f.event('turn/started', { turn: turn() });
  f.event('item/agentMessage/delta', { turnId: 'turn-a', itemId: 'item-a', delta: 'hello' });
  f.event('turn/completed', { turn: turn('completed') });
  f.respond('turn/start', { turn: turn() });
  assert.equal(f.client.phase, 'idle'); assert.equal(f.client.activeTurnId, undefined);
  assert.deepEqual(events, ['turn/started', 'item/agentMessage/delta', 'turn/completed']);
  await pending; f.client.disconnect();
});

test('Codex turn rejection is distinct from unknown delivery and never replays', async () => {
  for (const scenario of ['rejected', 'disconnected', 'write-failed', 'conflicting-result']) {
    if (scenario === 'write-failed') {
      let client!: CodexClient;
      client = new CodexClient({ write: packet => {
        if (packet.method === 'initialize') client.receive({ id: packet.id, result: { userAgent: 'codex' } });
        else if (packet.method === 'thread/start') client.receive({ id: packet.id, result: { cwd, thread: thread() } });
        else if (packet.method === 'turn/start') return Promise.reject(new Error('Pipe failed'));
      } });
      await client.initialize(); await client.open(cwd);
      await assert.rejects(client.startTurn('hello', 'id'), RpcConnectionError);
      assert.equal(client.phase, 'disconnected'); continue;
    }
    const f = fixture(); await f.ready(); const pending = f.client.startTurn('hello', 'client-a');
    const checked = assert.rejects(pending, scenario === 'rejected' ? RpcResponseError : RpcConnectionError);
    if (scenario === 'rejected') f.client.receive({ id: f.last('turn/start').id, error: { code: -32602, message: 'Rejected' } });
    else if (scenario === 'conflicting-result') { f.event('turn/started', { turn: turn() }); f.respond('turn/start', { turn: turn('inProgress', 'another') }); }
    else f.client.disconnect('Pipe closed');
    await checked; assert.equal(f.client.phase, scenario === 'rejected' ? 'idle' : 'disconnected');
    assert.equal(f.sent.filter(packet => packet.method === 'turn/start').length, 1);
    f.client.disconnect();
  }
});

test('Codex steer and interrupt target only the identified active turn; interrupt ACK is not completion', async () => {
  const f = fixture(); await f.working();
  const steering = f.client.steer('new detail', 'client-b');
  assert.deepEqual(f.last('turn/steer').params, { threadId: 'thread-a', expectedTurnId: 'turn-a', clientUserMessageId: 'client-b', input: [{ type: 'text', text: 'new detail', text_elements: [] }] });
  f.respond('turn/steer', { turnId: 'turn-a' }); await steering;
  const interrupting = f.client.interrupt();
  assert.deepEqual(f.last('turn/interrupt').params, { threadId: 'thread-a', turnId: 'turn-a' });
  f.respond('turn/interrupt', {}); await interrupting;
  assert.equal(f.client.phase, 'working');
  f.event('turn/completed', { turn: turn('interrupted') });
  assert.equal(f.client.phase, 'idle');
  await assert.rejects(f.client.steer('late', 'id'), /no identified active turn/);
  await assert.rejects(f.client.interrupt(), /no identified active turn/);
  f.client.disconnect();
});

test('Codex live paginated resume stays busy without inventing an active turn ID', async () => {
  const f = fixture(); await f.initialize(); const pending = f.client.open(cwd, 'saved');
  f.respond('thread/resume', { cwd, thread: { ...thread('saved'), status: { type: 'active', activeFlags: [] } } }); await pending;
  assert.equal(f.client.phase, 'working');
  await assert.rejects(f.client.startTurn('unsafe', 'id'), /not idle/);
  await assert.rejects(f.client.interrupt(), /no identified active turn/);
  f.event('turn/completed', { turn: turn('completed') }, 'saved');
  assert.equal(f.client.phase, 'idle'); f.client.disconnect();
});

test('Codex discovery keeps pagination and filters foreign projects, ephemeral threads and subagents', async () => {
  const f = fixture(); await f.initialize(); const listing = f.client.listThreads(cwd);
  f.respond('thread/list', { data: [thread('saved'), thread('foreign', '/other'), { ...thread('temp'), ephemeral: true }, { ...thread('child'), parentThreadId: 'parent' }], nextCursor: 'next' });
  assert.deepEqual(await listing, { data: [thread('saved')], nextCursor: 'next' });
  const next = f.client.listThreads(cwd, 'next'); assert.equal((f.last('thread/list').params as Record<string, unknown>).cursor, 'next');
  f.respond('thread/list', { data: [], nextCursor: null }); await next;
  assert.equal(f.sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  f.client.disconnect();
});

test('Codex history exposes turn and item pages instead of assuming resume returns all history', async () => {
  const f = fixture(); await f.ready(); const turns = f.client.listTurns();
  assert.deepEqual(f.last('thread/turns/list').params, { threadId: 'thread-a', sortDirection: 'asc', itemsView: 'full', limit: 100 });
  f.respond('thread/turns/list', { data: [turn('completed')], nextCursor: 'older' });
  assert.equal((await turns).nextCursor, 'older');
  const items = f.client.listItems('turn-a', 'cursor');
  const native = { turnId: 'turn-a', item: { id: 'unknown-a', type: 'futureItem', nativeData: { x: 1 } } };
  f.respond('thread/items/list', { data: [native], nextCursor: null });
  assert.deepEqual(await items, { data: [native], nextCursor: null });
  const invalid = assert.rejects(f.client.listItems('turn-a'), /another turn/);
  f.respond('thread/items/list', { data: [{ ...native, turnId: 'other' }], nextCursor: null });
  await invalid; assert.equal(f.client.phase, 'disconnected');
});

test('Codex approvals retain native scope, remain pending and retire on server resolution without answering', async () => {
  let signal!: AbortSignal; let answer!: (decision: CodexApprovalDecision) => void;
  const requests: unknown[] = [];
  const f = fixture({ approval: (request, abort) => { requests.push(request); signal = abort; return new Promise(resolve => { answer = resolve; }); } });
  await f.working();
  const params = { threadId: 'thread-a', turnId: 'turn-a', itemId: 'item-a', command: 'echo fixture', approvalId: 'callback-a' };
  f.client.receive({ id: 'request-a', method: 'item/commandExecution/requestApproval', params });
  assert.equal(requests.length, 1); assert.equal(signal.aborted, false);
  assert.equal(f.sent.some(packet => packet.id === 'request-a'), false);
  f.event('serverRequest/resolved', { requestId: 'request-a' }); assert.equal(signal.aborted, true);
  answer('accept'); await flush();
  assert.equal(f.sent.some(packet => packet.id === 'request-a'), false, 'no stale answer after resolution');
  f.client.disconnect();
});

test('Codex command and file approvals send only explicit supported decisions', async () => {
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
    const f = fixture({ approval: async () => 'acceptForSession' }); await f.working();
    f.client.receive({ id: 'approval', method, params: { threadId: 'thread-a', turnId: 'turn-a', itemId: 'item-a' } });
    await flush(); assert.deepEqual(f.sent.at(-1), { id: 'approval', result: { decision: 'acceptForSession' } });
    f.client.disconnect();
  }
});

test('Codex unknown/experimental requests and wrong-owner approvals never become grants', async () => {
  let approvals = 0;
  const f = fixture({ approval: async () => { approvals++; return 'accept'; } }); await f.working();
  for (const [id, method, owner] of [['foreign', 'item/commandExecution/requestApproval', 'other'], ['question', 'item/tool/requestUserInput', 'thread-a'], ['unknown', 'future/request', 'thread-a']]) {
    f.client.receive({ id, method, params: { threadId: owner, turnId: 'turn-a', itemId: 'item-a' } });
  }
  await flush(); assert.equal(approvals, 0);
  for (const id of ['foreign', 'question', 'unknown']) assert.ok(f.sent.find(packet => packet.id === id)?.error);
  f.client.disconnect();
});

test('Codex completion/disconnect aborts pending decisions and ignores late replies', async () => {
  for (const disconnect of [false, true]) {
    let signal!: AbortSignal; let answer!: (decision: CodexApprovalDecision) => void;
    const f = fixture({ approval: (_request, abort) => { signal = abort; return new Promise(resolve => { answer = resolve; }); } }); await f.working();
    f.client.receive({ id: 99, method: 'item/fileChange/requestApproval', params: { threadId: 'thread-a', turnId: 'turn-a', itemId: 'item-a' } });
    if (disconnect) f.client.disconnect(); else f.event('turn/completed', { turn: turn('interrupted') });
    assert.equal(signal.aborted, true); answer('accept'); await flush();
    assert.equal(f.sent.some(packet => packet.id === 99), false); f.client.disconnect();
  }
});

test('Codex acknowledgement timeout disconnects once, retains identity and never retries', async () => {
  const f = fixture({}, 10); await f.ready();
  await assert.rejects(f.client.startTurn('hello', 'id'), RpcConnectionError);
  assert.equal(f.client.phase, 'disconnected'); assert.equal(f.client.threadId, 'thread-a');
  assert.equal(f.sent.filter(packet => packet.method === 'turn/start').length, 1);
});
