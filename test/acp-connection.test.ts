import assert from 'node:assert/strict';
import test from 'node:test';
import { AcpConnection, AcpConnectionError, AcpResponseError, type AcpPacket } from '../src/acp/connection';

const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('ACP applies response state synchronously before the next notification', async () => {
  const sent: AcpPacket[] = [], order: string[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); }, {
    notification: method => order.push(method),
  });
  const pending = connection.request('initialize', {}, () => order.push('initialized'));
  connection.receive(reply(sent[0].id, {}));
  connection.receive({ jsonrpc: '2.0', method: 'session/update', params: {} });
  assert.deepEqual(order, ['initialized', 'session/update']);
  await pending;
});

test('ACP separates explicit rejection from unknown delivery and never retries', async () => {
  const sent: AcpPacket[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); });
  const rejected = connection.request('session/prompt', {});
  connection.receive({ jsonrpc: '2.0', id: sent[0].id, error: { code: -32602, message: 'Bad prompt' } });
  await assert.rejects(rejected, AcpResponseError);
  const uncertain = connection.request('session/prompt', {});
  const checked = assert.rejects(uncertain, AcpConnectionError);
  connection.disconnect('child exited');
  await checked;
  connection.receive(reply(sent[1].id, {}));
  await assert.rejects(connection.request('session/prompt', {}), AcpConnectionError);
  assert.equal(sent.length, 2);
});

test('ACP validation failure rejects the matching request and all other pending work', async () => {
  const sent: AcpPacket[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); });
  const first = connection.request('initialize', {}, () => { throw new Error('Bad handshake'); });
  const second = connection.request('other', {});
  const checked = Promise.all([assert.rejects(first, AcpConnectionError), assert.rejects(second, AcpConnectionError)]);
  connection.receive(reply(sent[0].id, {}));
  await checked;
  assert.equal(connection.connected, false);
});

test('ACP bidirectional request IDs do not collide with outgoing IDs', async () => {
  const sent: AcpPacket[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); }, {
    request: async (method, params) => ({ method, params }),
  });
  const pending = connection.request('initialize', {});
  connection.receive({ jsonrpc: '2.0', id: sent[0].id, method: 'agent/question', params: { question: 'x' } });
  await flush();
  assert.deepEqual(sent[1], { jsonrpc: '2.0', id: sent[0].id, result: { method: 'agent/question', params: { question: 'x' } } });
  connection.receive(reply(sent[0].id, { initialized: true }));
  assert.deepEqual(await pending, { initialized: true });
});

test('ACP unimplemented client methods are rejected, not executed', async () => {
  const sent: AcpPacket[] = [];
  const connection = new AcpConnection(packet => { sent.push(packet); });
  connection.receive({ jsonrpc: '2.0', id: 'agent-1', method: 'terminal/create', params: {} });
  await flush();
  assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 'agent-1', error: { code: -32601, message: 'Method not found' } }]);
});

test('ACP disconnect aborts incoming handlers and suppresses their late results', async () => {
  const sent: AcpPacket[] = [];
  let finish: (value: unknown) => void = () => {};
  let signal: AbortSignal | undefined;
  const connection = new AcpConnection(packet => { sent.push(packet); }, {
    request: (_method, _params, current) => {
      signal = current;
      return new Promise(resolve => { finish = resolve; });
    },
  });
  connection.receive({ jsonrpc: '2.0', id: 1, method: 'session/request_permission', params: {} });
  await flush();
  connection.disconnect();
  assert.equal(signal?.aborted, true);
  finish({ approved: true });
  await flush();
  assert.equal(sent.length, 0);
});

test('ACP write failures invalidate the connection without resending', async () => {
  let writes = 0;
  const connection = new AcpConnection(async () => { writes++; throw new Error('broken pipe'); });
  await assert.rejects(connection.request('session/prompt', {}), AcpConnectionError);
  assert.equal(connection.connected, false);
  assert.equal(writes, 1);
});

test('ACP rejects malformed framing records and duplicate active agent IDs', async () => {
  for (const packet of [
    null, [], { jsonrpc: '1.0' }, { jsonrpc: '2.0', id: null, result: {} },
    { jsonrpc: '2.0', id: 1, result: {}, error: {} },
    { jsonrpc: '2.0', id: 1, method: 'x', result: {} },
    { jsonrpc: '2.0', id: 1, error: { code: 'bad', message: 'x' } },
  ]) {
    const connection = new AcpConnection(() => {});
    connection.receive(packet);
    assert.equal(connection.connected, false);
  }
  const connection = new AcpConnection(() => {}, { request: () => new Promise(() => {}) });
  const request = { jsonrpc: '2.0', id: 'same', method: 'pending', params: {} };
  connection.receive(request);
  connection.receive(request);
  assert.equal(connection.connected, false);
  await flush();
});
