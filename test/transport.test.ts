import assert from 'node:assert/strict';
import test from 'node:test';
import { PiTransport, RpcResponseError, RpcTransportError } from '../src/pi/transport';
import type { JsonRecord } from '../src/pi/types';

test('history callbacks run synchronously in wire order before later events', async () => {
  let request: JsonRecord = {};
  const rpc = new PiTransport(async message => { request = message; });
  const order: string[] = [];
  rpc.onEvent = e => order.push(String(e.type));
  const pending = rpc.request('get_messages', {}, 1000, () => order.push('snapshot'));
  rpc.receive({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } });
  rpc.receive({ kind: 'rpc', value: { type: 'message_start' } });
  assert.deepEqual(order, ['snapshot', 'message_start']);
  await pending;
});

test('timeout is unknown, never retried, and late acknowledgements are ignored', async () => {
  const requests: JsonRecord[] = [];
  const rpc = new PiTransport(async message => { requests.push(message); });
  await assert.rejects(rpc.request('prompt', { message: 'once' }, 10), RpcTransportError);
  rpc.receive({ kind: 'rpc', value: { type: 'response', id: requests[0].id, success: true } });
  assert.equal(requests.length, 1);
});

test('disconnect rejects every pending request and ignores subsequent events', async () => {
  const rpc = new PiTransport(async () => {});
  const events: unknown[] = [];
  rpc.onEvent = e => events.push(e);
  const a = rpc.request('get_state'), b = rpc.request('prompt');
  const checks = Promise.all([assert.rejects(a, RpcTransportError), assert.rejects(b, RpcTransportError)]);
  rpc.receive({ kind: 'disconnected', message: 'process exited' });
  rpc.receive({ kind: 'rpc', value: { type: 'agent_start' } });
  await checks;
  assert.equal(events.length, 1);
  await assert.rejects(rpc.request('get_state'), RpcTransportError);
});

test('explicit Pi rejection is distinguishable from uncertain transport failure', async () => {
  let message: JsonRecord = {};
  const rpc = new PiTransport(async m => { message = m; });
  const result = rpc.request('prompt');
  rpc.receive({ kind: 'rpc', value: { type: 'response', id: message.id, success: false, error: 'No model' } });
  await assert.rejects(result, RpcResponseError);
});
