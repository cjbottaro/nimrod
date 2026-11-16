import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexClient } from '../src/codex/client';
import { codexDeletionTree } from '../src/codex/deletion-tree';
import type { CodexPacket } from '../src/codex/protocol';

const project = '/var/home/fixture/project';
const alias = '/home/fixture/project';
const thread = (cwd = project, id = 'saved') => ({ id, cwd, ephemeral: false, parentThreadId: null, forkedFromId: null, turns: [], status: { type: 'idle' as const } });

function fixture(savedCwd = project, runtimeCwd = alias, verified = true) {
  const sent: CodexPacket[] = [];
  let client!: CodexClient;
  client = new CodexClient({
    runtimeCwdMatches: (actual, expected) => verified && expected === project && actual === alias,
    write(packet) {
      sent.push(packet);
      if (packet.method === 'initialized') return;
      const params = packet.params as Record<string, unknown>;
      let result: unknown;
      if (packet.method === 'initialize') result = { userAgent: 'fixture' };
      else if (packet.method === 'thread/read') result = { thread: thread(savedCwd) };
      else if (packet.method === 'thread/resume') result = { cwd: runtimeCwd, thread: thread(runtimeCwd) };
      else if (packet.method === 'thread/list') {
        assert.equal(params.cwd, undefined, 'never request Codex alias-normalizing cwd filtering');
        result = { data: [thread(project), thread(alias, 'container-session')], nextCursor: null };
      } else if (packet.method === 'thread/settings/update') {
        result = {};
        client.receive({ method: 'thread/settings/updated', params: { threadId: 'saved', threadSettings: { cwd: runtimeCwd, model: params.model } } });
      } else throw new Error(`Unexpected operation ${packet.method}`);
      client.receive({ id: packet.id, result });
    },
  });
  return { client, sent };
}

test('Codex saved project membership remains exact while verified runtime aliases can resume', async () => {
  const f = fixture();
  try {
    await f.client.initialize();
    assert.deepEqual((await f.client.listThreads(project)).data.map(t => t.id), ['saved']);
    assert.deepEqual((await f.client.listThreads(alias)).data.map(t => t.id), ['container-session']);
    await f.client.open(project, 'saved');
    assert.equal(f.client.phase, 'idle');
    assert.deepEqual(f.sent.filter(p => ['thread/read', 'thread/resume'].includes(String(p.method))).map(p => p.method), ['thread/read', 'thread/resume']);
    await f.client.configure(project, 'model', 'model-two');
    assert.equal(f.client.phase, 'idle');
    assert.equal((await f.client.readBoundThread()).cwd, project);
    assert.equal(f.sent.some(p => ['thread/start', 'turn/start', 'thread/delete'].includes(String(p.method))), false);
  } finally { f.client.disconnect(); }
});

test('Codex runtime equivalence cannot authorize Resume of another saved project', async () => {
  const f = fixture(alias);
  try {
    await f.client.initialize();
    await assert.rejects(f.client.open(project, 'saved'), /saved project mismatch/);
    assert.equal(f.sent.some(p => p.method === 'thread/resume' || p.method === 'thread/start'), false);
  } finally { f.client.disconnect(); }
});

test('Codex Resume rejects unverified or unrelated runtime paths after metadata preflight', async () => {
  for (const [cwd, verified] of [[alias, false], ['/unrelated/project', true]] as const) {
    const f = fixture(project, cwd, verified);
    try {
      await f.client.initialize();
      await assert.rejects(f.client.open(project, 'saved'), /conflicting thread identity or project/);
      assert.equal(f.client.phase, 'disconnected');
      assert.equal(f.sent.filter(p => p.method === 'thread/resume').length, 1);
    } finally { f.client.disconnect(); }
  }
});

test('Codex deletion uses original unfiltered cwd, never runtime alias equivalence', () => {
  const inventory = [thread(project), thread(alias, 'container-session')];
  assert.deepEqual(codexDeletionTree(project, 'saved', inventory).ids, ['saved']);
  assert.throws(() => codexDeletionTree(alias, 'saved', inventory), /exact project/);
  assert.throws(() => codexDeletionTree(project, 'saved', [thread(project), { ...thread(alias, 'child'), parentThreadId: 'saved' }]), /Cross-project/);
});
