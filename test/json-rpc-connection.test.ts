import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonRpcConnection, RpcConnectionError, RpcResponseError, RpcWriteRejected, type RpcPacket } from '../src/json-rpc-connection';
import { AcpConnection, AcpConnectionError, AcpResponseError } from '../src/acp/connection';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('shared RPC keeps ACP error constructors and mandatory version framing', async () => {
  assert.equal(AcpConnectionError, RpcConnectionError); assert.equal(AcpResponseError, RpcResponseError);
  const sent: RpcPacket[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); });
  const pending = connection.request('initialize', {});
  assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
  const checked = assert.rejects(pending, AcpConnectionError);
  connection.receive({ id: 1, result: {} }); await checked;
  assert.equal(connection.connected, false);
});

test('RPC dialects preserve ordered apply-before-event and malformed-packet retirement', async () => {
  for (const versionMember of [false, true]) {
    const header = versionMember ? { jsonrpc: '2.0' as const } : {};
    const observed: string[] = [];
    const connection = new JsonRpcConnection(() => {}, { notification: () => { observed.push('event'); } }, { label: 'Fixture', versionMember });
    const pending = connection.request('read', {}, () => { observed.push('response'); });
    connection.receive({ ...header, id: 1, result: {} });
    connection.receive({ ...header, method: 'event', params: {} });
    assert.deepEqual(observed, ['response', 'event']); await pending;
    const failed = assert.rejects(connection.request('read', {}), RpcConnectionError);
    connection.receive({ ...header, id: 2, result: {}, error: { code: -1, message: 'bad' } }); await failed;
    assert.equal(connection.connected, false);
  }
});

test('proven not-written rejection fails one request without disconnecting or replaying other work', async () => {
  const sent: RpcPacket[] = [];
  const connection = new JsonRpcConnection(packet => { sent.push(packet); if (packet.method === 'blocked') return Promise.reject(new RpcWriteRejected('Reserved for deletion')); }, {}, { label: 'Fixture', versionMember: false });
  await assert.rejects(connection.request('blocked', {}), error => error instanceof RpcResponseError && error.data !== undefined);
  assert.equal(connection.connected, true);
  const next = connection.request('read', {}); connection.receive({ id: sent.at(-1)!.id, result: {} }); await next;
  assert.equal(sent.filter(packet => packet.method === 'blocked').length, 1); connection.disconnect();
});

test('headerless RPC rejects versioned packets instead of silently becoming another dialect', async () => {
  const connection = new JsonRpcConnection(() => {}, {}, { label: 'Codex', versionMember: false });
  const pending = assert.rejects(connection.request('read', {}), /Invalid Codex/);
  connection.receive({ jsonrpc: '2.0', id: 1, result: {} }); await pending;
});

test('server resolution aborts one request without answering it or cancelling unrelated work', async () => {
  const sent: RpcPacket[] = []; const signals: AbortSignal[] = [];
  const replies: ((value: unknown) => void)[] = [];
  const connection = new JsonRpcConnection(packet => { sent.push(packet); }, {
    request: (_method, _params, signal) => { signals.push(signal); return new Promise(resolve => { replies.push(resolve); }); },
  }, { label: 'Fixture', versionMember: false });
  connection.receive({ id: 'a', method: 'decision', params: {} });
  connection.receive({ id: 'b', method: 'decision', params: {} });
  connection.cancelIncoming('a'); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  replies[0]('stale'); replies[1]('current'); await flush();
  assert.deepEqual(sent, [{ id: 'b', result: 'current' }]); connection.disconnect();
});

test('a resolved request ID can be reused without a stale continuation removing its replacement', async () => {
  const sent: RpcPacket[] = []; const replies: ((value: unknown) => void)[] = [];
  const connection = new JsonRpcConnection(packet => { sent.push(packet); }, {
    request: () => new Promise(resolve => { replies.push(resolve); }),
  }, { label: 'Fixture', versionMember: false });
  connection.receive({ id: 'a', method: 'decision', params: {} }); connection.cancelIncoming('a');
  connection.receive({ id: 'a', method: 'decision', params: {} });
  replies[0]('old'); await flush(); replies[1]('new'); await flush();
  assert.deepEqual(sent, [{ id: 'a', result: 'new' }]); connection.disconnect();
});

test('duplicate active server request IDs retire the connection and both callback scopes', () => {
  let signal!: AbortSignal;
  const connection = new JsonRpcConnection(() => {}, { request: (_method, _params, abort) => { signal = abort; return new Promise(() => {}); } }, { label: 'Codex', versionMember: false });
  connection.receive({ id: 'a', method: 'decision', params: {} });
  connection.receive({ id: 'a', method: 'decision', params: {} });
  assert.equal(connection.connected, false); assert.equal(signal.aborted, true);
});
