import assert from 'node:assert/strict';
import test from 'node:test';
import packageInfo from '../package.json';
import { AcpClient, type AcpClientHooks } from '../src/acp/client';
import { AcpConnectionError, AcpResponseError, type AcpPacket } from '../src/acp/connection';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(hooks: AcpClientHooks = {}) {
  const sent: AcpPacket[] = [];
  const client = new AcpClient(packet => { sent.push(packet); }, hooks);
  const last = (method: string) => {
    const packet = [...sent].reverse().find(packet => packet.method === method);
    assert.ok(packet, `Missing ${method}`);
    return packet;
  };
  const respond = (method: string, result: unknown) => client.receive({ jsonrpc: '2.0', id: last(method).id, result });
  const update = (sessionId = 'session-a', kind = 'agent_message_chunk') => client.receive({
    jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: kind, content: { type: 'text', text: 'hello' } } },
  });
  const permission = (id = 'permission-1', sessionId = 'session-a', options: unknown[] = [
    { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'no', kind: 'reject_once', name: 'Reject' },
  ]) => client.receive({ jsonrpc: '2.0', id, method: 'session/request_permission', params: {
    sessionId, toolCall: { toolCallId: 'tool-1', title: 'Run command' }, options,
  } });
  const initialize = async (agentCapabilities: Record<string, unknown> = { promptCapabilities: { image: true } }) => {
    const pending = client.initialize();
    respond('initialize', { protocolVersion: 1, agentCapabilities });
    await pending;
  };
  const ready = async () => {
    await initialize();
    const creating = client.newSession('/fixture/project');
    respond('session/new', { sessionId: 'session-a', configOptions: [] });
    await creating;
  };
  return { client, sent, last, respond, update, permission, initialize, ready };
}

test('ACP initializes with no unimplemented host capabilities and creates only one session', async () => {
  const f = fixture();
  await f.ready();
  assert.deepEqual(f.last('initialize').params, {
    protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'nimrod', title: 'Nimrod', version: packageInfo.version },
  });
  assert.deepEqual(f.last('session/new').params, { cwd: '/fixture/project', mcpServers: [] });
  assert.equal(f.client.phase, 'idle');
  assert.equal(f.client.sessionId, 'session-a');
  assert.deepEqual(f.client.initialization?.agentCapabilities, { promptCapabilities: { image: true } });
  await assert.rejects(f.client.newSession('/another'), /unavailable/);
  assert.equal(f.sent.filter(packet => packet.method === 'session/new').length, 1);
});

test('ACP buffers pre-identity updates and releases them synchronously before later events', async () => {
  const events: string[] = [];
  const f = fixture({ update: event => events.push(event.update.sessionUpdate) });
  await f.initialize();
  const creating = f.client.newSession('/fixture/project');
  f.update('session-a', 'available_commands_update');
  assert.deepEqual(events, []);
  f.respond('session/new', { sessionId: 'session-a' });
  f.update();
  assert.deepEqual(events, ['available_commands_update', 'agent_message_chunk']);
  await creating;
});

test('ACP loads an exact saved identity and reduces unbounded-in-count replay in wire order', async () => {
  const events: string[] = [];
  const f = fixture({ update: event => events.push(event.update.sessionUpdate), loaded: () => events.push('loaded') });
  await f.initialize({ loadSession: true });
  const loading = f.client.loadSession('/fixture/project', 'saved-id');
  assert.equal(f.client.phase, 'loading');
  assert.deepEqual(f.last('session/load').params, { cwd: '/fixture/project', sessionId: 'saved-id', mcpServers: [] });
  for (let i = 0; i < 200; i++) f.update('saved-id', 'user_message_chunk');
  assert.equal(events.length, 200, 'known-identity replay does not use the 128-event creation buffer');
  await assert.rejects(f.client.prompt('not yet'), /unavailable/);
  f.respond('session/load', { configOptions: [] });
  f.update('saved-id');
  assert.deepEqual(events.slice(-2), ['loaded', 'agent_message_chunk'], 'load response applies before later wire events');
  await loading;
  assert.equal(f.client.sessionId, 'saved-id');
  assert.equal(f.client.phase, 'idle');
  assert.equal(f.sent.some(packet => packet.method === 'session/new' || packet.method === 'session/prompt'), false);
});

test('ACP never loads without an advertised capability', async () => {
  for (const capabilities of [{}, { loadSession: false }]) {
    const f = fixture();
    await f.initialize(capabilities);
    await assert.rejects(f.client.loadSession('/fixture/project', 'saved-id'), /does not support loading/);
    assert.equal(f.sent.length, 1);
  }
});

test('ACP lists paginated project history without creating or loading a session', async () => {
  const f = fixture();
  await f.initialize({ loadSession: true, sessionCapabilities: { list: {} } });
  const first = f.client.listSessions('/fixture/project');
  assert.deepEqual(f.last('session/list').params, { cwd: '/fixture/project' });
  f.respond('session/list', { sessions: [{ sessionId: 'saved', cwd: '/fixture/project', title: 'Saved title', updatedAt: '2026-10-16T12:00:00Z' }], nextCursor: 'next' });
  assert.deepEqual(await first, { sessions: [{ sessionId: 'saved', cwd: '/fixture/project', title: 'Saved title', updatedAt: '2026-10-16T12:00:00Z' }], nextCursor: 'next' });
  const second = f.client.listSessions('/fixture/project', 'next');
  assert.deepEqual(f.last('session/list').params, { cwd: '/fixture/project', cursor: 'next' });
  f.respond('session/list', { sessions: [], nextCursor: null });
  assert.deepEqual(await second, { sessions: [], nextCursor: undefined });
  assert.equal(f.client.phase, 'ready');
  assert.equal(f.client.sessionId, undefined);
  assert.equal(f.sent.some(packet => ['session/new', 'session/load', 'session/prompt'].includes(String(packet.method))), false);
});

test('ACP listing requires advertised list and load support and rejects invalid results', async () => {
  for (const capabilities of [{}, { loadSession: true }, { sessionCapabilities: { list: {} } }, { loadSession: true, sessionCapabilities: { list: false } }]) {
    const f = fixture();
    await f.initialize(capabilities);
    await assert.rejects(f.client.listSessions('/fixture/project'), /does not advertise/);
    assert.equal(f.sent.length, 1);
  }
  for (const result of [{}, { sessions: [{}] }, { sessions: [], nextCursor: 5 },
    { sessions: [{ sessionId: '', cwd: '/fixture/project' }] },
    { sessions: [{ sessionId: 'a', cwd: '/fixture/project', updatedAt: 'bad date' }] }]) {
    const f = fixture();
    await f.initialize({ loadSession: true, sessionCapabilities: { list: {} } });
    const pending = assert.rejects(f.client.listSessions('/fixture/project'), /Invalid ACP/);
    f.respond('session/list', result);
    await pending;
    assert.equal(f.client.phase, 'disconnected');
  }
});

test('ACP failed, mismatched or disconnected loading never creates a replacement or retries', async () => {
  for (const scenario of ['rejected', 'wrong-update', 'wrong-result', 'disconnected']) {
    const f = fixture();
    await f.initialize({ loadSession: true });
    const loading = f.client.loadSession('/fixture/project', 'saved-id');
    const checked = assert.rejects(loading);
    if (scenario === 'rejected') f.client.receive({ jsonrpc: '2.0', id: f.last('session/load').id, error: { code: -32602, message: 'Missing history' } });
    else if (scenario === 'wrong-update') f.update('another-id');
    else if (scenario === 'wrong-result') f.respond('session/load', { sessionId: 'another-id' });
    else f.client.disconnect('Process exited');
    await checked;
    assert.equal(f.client.phase, 'disconnected');
    assert.equal(f.sent.filter(packet => packet.method === 'session/load').length, 1);
    assert.equal(f.sent.some(packet => packet.method === 'session/new' || packet.method === 'session/prompt'), false);
  }
});

test('ACP deletion requires advertised support, an ID and a discovery-only connection', async () => {
  for (const capabilities of [{}, { sessionCapabilities: { delete: null } }, { sessionCapabilities: { delete: true } }]) {
    const f = fixture();
    await f.initialize(capabilities);
    assert.equal(f.client.supportsSessionDeletion, false);
    await assert.rejects(f.client.deleteSession('saved'), /does not advertise/);
    assert.equal(f.sent.length, 1);
  }
  const f = fixture();
  await f.initialize({ sessionCapabilities: { delete: {} } });
  await assert.rejects(f.client.deleteSession(' '), /requires a session ID/);
  const deleting = f.client.deleteSession('saved');
  assert.deepEqual(f.last('session/delete').params, { sessionId: 'saved' });
  f.respond('session/delete', {});
  await deleting;
  assert.equal(f.client.phase, 'ready');
  assert.equal(f.client.sessionId, undefined);
  assert.equal(f.sent.some(packet => ['session/new', 'session/load', 'session/prompt'].includes(String(packet.method))), false);
  const conversation = fixture();
  await conversation.ready();
  await assert.rejects(conversation.client.deleteSession('session-a'), /unavailable/);
});

test('ACP deletion rejects malformed or uncertain replies and never retries', async () => {
  for (const outcome of ['malformed', 'disconnected', 'rejected']) {
    const f = fixture();
    await f.initialize({ sessionCapabilities: { delete: {} } });
    const deleting = assert.rejects(f.client.deleteSession('saved'));
    if (outcome === 'malformed') f.respond('session/delete', null);
    else if (outcome === 'disconnected') f.client.disconnect('Lost response');
    else f.client.receive({ jsonrpc: '2.0', id: f.last('session/delete').id, error: { code: -32601, message: 'Unsupported' } });
    await deleting;
    assert.equal(f.sent.filter(packet => packet.method === 'session/delete').length, 1);
  }
});

test('ACP rejects unsupported protocol versions without creating a session', async () => {
  const f = fixture();
  const pending = f.client.initialize();
  const checked = assert.rejects(pending, AcpConnectionError);
  f.respond('initialize', { protocolVersion: 999, agentCapabilities: {} });
  await checked;
  assert.equal(f.client.phase, 'disconnected');
  assert.equal(f.sent.length, 1);
});

test('ACP prompt remains working through streaming and cancellation until authoritative completion', async () => {
  const events: string[] = [];
  const f = fixture({ update: event => events.push(event.update.sessionUpdate) });
  await f.ready();
  const pending = f.client.prompt('once');
  assert.deepEqual(f.last('session/prompt').params, { sessionId: 'session-a', prompt: [{ type: 'text', text: 'once' }] });
  f.update();
  assert.equal(f.client.phase, 'working');
  await assert.rejects(f.client.prompt('not queued'), /unavailable/);
  f.client.cancel();
  f.client.cancel();
  assert.equal(f.client.phase, 'working');
  assert.equal(f.sent.filter(packet => packet.method === 'session/cancel').length, 1);
  f.respond('session/prompt', { stopReason: 'cancelled' });
  assert.equal(f.client.phase, 'idle');
  assert.equal(await pending, 'cancelled');
  assert.deepEqual(events, ['agent_message_chunk']);
  assert.equal(f.sent.filter(packet => packet.method === 'session/prompt').length, 1);
});

test('ACP permissions default to cancellation, not approval', async () => {
  const f = fixture();
  await f.ready();
  const pending = f.client.prompt('command');
  f.permission();
  await flush();
  assert.deepEqual(f.sent.find(packet => packet.id === 'permission-1')?.result, { outcome: { outcome: 'cancelled' } });
  f.respond('session/prompt', { stopReason: 'end_turn' });
  await pending;
});

test('ACP permission responses can select only an offered option', async () => {
  for (const selection of ['once', 'no', 'invented', undefined]) {
    const f = fixture({ permission: async () => selection });
    await f.ready();
    const pending = f.client.prompt('command');
    f.permission();
    await flush();
    const expected = selection === 'once' || selection === 'no'
      ? { outcome: { outcome: 'selected', optionId: selection } } : { outcome: { outcome: 'cancelled' } };
    assert.deepEqual(f.sent.find(packet => packet.id === 'permission-1')?.result, expected);
    f.respond('session/prompt', { stopReason: 'end_turn' });
    await pending;
  }
});

test('ACP cancellation aborts pending permission UI and ignores late approval', async () => {
  let finish: (value: string) => void = () => {};
  let signal: AbortSignal | undefined;
  const f = fixture({ permission: (_request, current) => {
    signal = current;
    return new Promise(resolve => { finish = resolve; });
  } });
  await f.ready();
  const pending = f.client.prompt('command');
  f.permission();
  await flush();
  f.client.cancel();
  await flush();
  assert.equal(signal?.aborted, true);
  finish('once');
  await flush();
  const replies = f.sent.filter(packet => packet.id === 'permission-1');
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].result, { outcome: { outcome: 'cancelled' } });
  f.respond('session/prompt', { stopReason: 'cancelled' });
  await pending;
});

test('ACP permissions for another session and requests after cancellation never open UI', async () => {
  let calls = 0;
  const f = fixture({ permission: async () => { calls++; return 'once'; } });
  await f.ready();
  const pending = f.client.prompt('command');
  f.permission('other', 'session-b');
  await flush();
  f.client.cancel();
  f.permission('cancelled');
  await flush();
  assert.equal(calls, 0);
  for (const id of ['other', 'cancelled']) assert.deepEqual(f.sent.find(packet => packet.id === id)?.result, { outcome: { outcome: 'cancelled' } });
  f.respond('session/prompt', { stopReason: 'cancelled' });
  await pending;
});

test('ACP disconnect suppresses old updates and pending permission replies without prompt replay', async () => {
  let finish: (value: string) => void = () => {};
  let updates = 0;
  const f = fixture({
    update: () => { updates++; },
    permission: () => new Promise(resolve => { finish = resolve; }),
  });
  await f.ready();
  const pending = f.client.prompt('once');
  const checked = assert.rejects(pending, AcpConnectionError);
  f.permission();
  await flush();
  f.client.disconnect('owned process exited');
  finish('once');
  f.update();
  f.respond('session/prompt', { stopReason: 'end_turn' });
  await checked;
  await flush();
  assert.equal(f.client.phase, 'disconnected');
  assert.equal(updates, 0);
  assert.equal(f.sent.filter(packet => packet.id === 'permission-1').length, 0);
  assert.equal(f.sent.filter(packet => packet.method === 'session/prompt').length, 1);
});

test('ACP explicit prompt rejection permits a new user action without replaying the old one', async () => {
  const f = fixture();
  await f.ready();
  const pending = f.client.prompt('old');
  f.client.receive({ jsonrpc: '2.0', id: f.last('session/prompt').id, error: { code: -32602, message: 'Rejected' } });
  await assert.rejects(pending, AcpResponseError);
  assert.equal(f.client.phase, 'idle');
  const next = f.client.prompt('new');
  f.respond('session/prompt', { stopReason: 'end_turn' });
  await next;
  assert.equal(f.sent.filter(packet => packet.method === 'session/prompt').length, 2);
});

test('ACP malformed permission options and unsupported host methods fail closed', async () => {
  let calls = 0;
  const f = fixture({ permission: async () => { calls++; return 'once'; } });
  await f.ready();
  const pending = f.client.prompt('command');
  f.permission('bad', 'session-a', [{ optionId: 'once', kind: 'invented', name: 'Allow' }]);
  f.client.receive({ jsonrpc: '2.0', id: 'fs', method: 'fs/write_text_file', params: {} });
  await flush();
  assert.equal(calls, 0);
  assert.equal((f.sent.find(packet => packet.id === 'bad')?.error as { code: number }).code, -32602);
  assert.equal((f.sent.find(packet => packet.id === 'fs')?.error as { code: number }).code, -32601);
  f.respond('session/prompt', { stopReason: 'end_turn' });
  await pending;
});

test('ACP failed session identity and pre-identity overflow never fall back to a replacement session', async () => {
  for (const scenario of ['mismatch', 'overflow']) {
    const f = fixture();
    await f.initialize();
    const pending = f.client.newSession('/fixture/project');
    const checked = assert.rejects(pending, AcpConnectionError);
    if (scenario === 'mismatch') {
      f.update('different-session');
      f.respond('session/new', { sessionId: 'session-a' });
    } else for (let i = 0; i < 129; i++) f.update();
    await checked;
    assert.equal(f.client.phase, 'disconnected');
    assert.equal(f.sent.filter(packet => packet.method === 'session/new').length, 1);
  }
});
