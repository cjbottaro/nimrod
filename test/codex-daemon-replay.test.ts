import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexClient, type CodexClientHooks } from '../src/codex/client';
import type { CodexPacket, CodexApprovalDecision } from '../src/codex/protocol';

const cwd = '/fixture/project';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function fixture(hooks: CodexClientHooks) {
  const sent: CodexPacket[] = [];
  const client = new CodexClient({ write: packet => { sent.push(packet); } }, hooks);
  const request = (method: string) => [...sent].reverse().find(packet => packet.method === method)!;
  const initialized = client.initialize();
  client.receive({ id: request('initialize').id, result: { userAgent: 'fixture/0.169.0' } });
  await initialized;
  const resume = client.open(cwd, 'shared-thread');
  const resumed = () => client.receive({ id: request('thread/resume').id, result: { cwd,
    thread: { id: 'shared-thread', cwd, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'active', activeFlags: [] } } } });
  const approval = (id = 'approval') => client.receive({ id, method: 'item/commandExecution/requestApproval',
    params: { threadId: 'shared-thread', turnId: 'shared-turn', itemId: 'command', approvalId: id } });
  return { client, sent, resume, resumed, approval };
}

test('daemon approval replay waits for exact Resume identity and remains user-controlled', async () => {
  let called = false, resolve!: (decision: CodexApprovalDecision) => void;
  const f = await fixture({ approval: () => { called = true; return new Promise(ready => { resolve = ready; }); } });
  try {
    f.approval(); await flush();
    assert.equal(called, false);
    assert.equal(f.sent.some(packet => packet.id === 'approval'), false, 'no premature rejection of shared approval');
    f.resumed(); await f.resume; await flush();
    assert.equal(called, true);
    assert.equal(f.client.activeTurnId, 'shared-turn');
    resolve('accept'); await flush();
    assert.deepEqual(f.sent.find(packet => packet.id === 'approval'), { id: 'approval', result: { decision: 'accept' } });
    assert.equal(f.sent.some(packet => ['thread/start', 'turn/start', 'turn/interrupt'].includes(String(packet.method))), false);
  } finally { f.client.disconnect(); }
});

test('another client resolving replayed approval before Resume binding suppresses the picker and reply', async () => {
  let called = false;
  const f = await fixture({ approval: async () => { called = true; return 'accept'; } });
  try {
    f.approval();
    f.client.receive({ method: 'serverRequest/resolved', params: { threadId: 'shared-thread', requestId: 'approval' } });
    f.resumed(); await f.resume; await flush();
    assert.equal(called, false);
    assert.equal(f.sent.some(packet => packet.id === 'approval'), false);
  } finally { f.client.disconnect(); }
});

test('detaching during daemon replay does not answer, interrupt or replay work', async () => {
  let called = false;
  const f = await fixture({ approval: async () => { called = true; return 'accept'; } });
  const rejected = assert.rejects(f.resume);
  f.approval(); f.client.disconnect('Nimrod detached');
  await rejected; await flush();
  assert.equal(called, false);
  assert.equal(f.sent.some(packet => packet.id === 'approval' || packet.method === 'turn/interrupt'), false);
});

test('daemon pre-identity requests share the bounded event budget', async () => {
  const f = await fixture({ approval: async () => 'accept' });
  const rejected = assert.rejects(f.resume, /buffer exceeded/);
  for (let i = 0; i <= 128; i++) f.approval(`approval-${i}`);
  await rejected; await flush();
  assert.equal(f.client.phase, 'disconnected');
  assert.equal(f.sent.some(packet => String(packet.id).startsWith('approval-')), false);
});
