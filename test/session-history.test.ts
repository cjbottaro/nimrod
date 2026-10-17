import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotSessionHistory, type CopilotHistoryHost } from '../src/acp/session-history';
import { PiSessionHistory } from '../src/pi/session-history';
import { loadSessionHistory, type SessionHistory, type SessionHistoryPage, type SessionHistorySnapshot } from '../src/session-history';
import { savedSessionKey, resolveSessionListEntry, type SessionListEntry } from '../src/session-list';
import type { AcpPacket } from '../src/acp/connection';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const entry = (id: string): SessionListEntry => {
  const reference = { kind: 'acp' as const, profile: 'copilot' as const, sessionId: id };
  return { key: savedSessionKey(reference), reference, title: id, harnessLabel: 'Copilot ACP', open: false, status: 'closed' };
};
const source = (id: string, list: SessionHistory['list']): SessionHistory => ({ id, label: id, list, async dispose() {} });

test('shared list identities qualify saved references and overlay only the matching open session', () => {
  const closed = { ...entry('same-id'), timestamp: 100, keywords: 'search preview' };
  const open: SessionListEntry = { ...closed, title: 'Live title', timestamp: 200, open: true, status: 'input', keywords: undefined };
  assert.deepEqual(resolveSessionListEntry(closed, [open]), { ...open, keywords: 'search preview' });
  assert.equal(resolveSessionListEntry(closed, []), closed);
  const pi = { path: '/sessions/a', sessionId: 'same-id' };
  assert.notEqual(savedSessionKey(pi), closed.key);
  assert.notEqual(savedSessionKey(pi), savedSessionKey({ ...pi, sessionId: 'replacement' }));
});

test('history publishes independent sources and pages in source order, with source-local failures', async () => {
  let release!: (page: SessionHistoryPage) => void;
  const slow = new Promise<SessionHistoryPage>(resolve => { release = resolve; });
  const snapshots: SessionHistorySnapshot[] = [];
  const cursors: (string | undefined)[] = [];
  const pending = loadSessionHistory([
    source('Pi', async () => ({ entries: [entry('pi')], warnings: [] })),
    source('Copilot', async ({ cursor }) => {
      cursors.push(cursor);
      if (!cursor) return slow;
      throw new Error('Second page unavailable');
    }),
  ], new AbortController().signal, snapshot => snapshots.push(snapshot));
  await flush();
  assert.ok(snapshots.some(snapshot => snapshot.entries[0]?.title === 'pi' && snapshot.pending.includes('Copilot')));
  release({ entries: [entry('copilot')], nextCursor: 'next', warnings: [] });
  const result = await pending;
  assert.deepEqual(result.entries.map(entry => entry.title), ['pi', 'copilot']);
  assert.deepEqual(cursors, [undefined, 'next']);
  assert.deepEqual(result.pending, []);
  assert.match(result.issues[0].message, /Second page unavailable/);
});

test('history deduplicates pages, reports repeated cursors and preserves other sources', async () => {
  const result = await loadSessionHistory([
    source('bad', async () => ({ entries: [entry('a')], nextCursor: 'again', warnings: [] })),
    source('good', async () => ({ entries: [entry('b')], warnings: ['Unreadable fixture'] })),
  ], new AbortController().signal, () => {});
  assert.deepEqual(result.entries.map(entry => entry.title), ['a', 'b']);
  assert.match(result.issues[0].message, /repeated a pagination cursor/);
  assert.match(result.issues[1].message, /Unreadable fixture/);
});

test('Pi history retains catalog ordering, exact-file inspection, child exclusion and recency', async () => {
  const inspected: string[] = [];
  const pi = new PiSessionHistory({
    catalog: async () => ({ sessions: [
      { path: '/sessions/a', sessionId: 'a', preview: 'Question A', modified: 20, lastUserMessageAt: 100 },
      { path: '/sessions/b', sessionId: 'b', preview: 'Question B', modified: 30, parentSession: '/sessions/a' },
      { path: '/sessions/deleted', sessionId: 'deleted', preview: '', modified: 50 },
    ], warnings: ['/sessions/unreadable'] }),
    inspect: async path => { inspected.push(path); return { path, sessionId: 'external', exists: true, lastUserMessageAt: 300 }; },
    open: () => [{ key: 'external', title: 'Open exact file', harnessLabel: 'Pi', status: 'ready', open: true, reference: { path: '/elsewhere/exact', sessionId: 'external' } }],
    removed: path => path === '/sessions/deleted',
    recency: () => 200,
  });
  const result = await pi.list({ signal: new AbortController().signal });
  assert.deepEqual(inspected, ['/elsewhere/exact']);
  assert.deepEqual(result.entries.map(entry => [entry.title, entry.timestamp, entry.status]), [['Question A', 200, 'closed'], ['Open exact file', 300, 'closed']]);
  assert.match(result.warnings[0], /unreadable/);
});

function copilotFixture(options: {
  startGate?: Promise<void>; startError?: string; stopError?: string; capabilities?: Record<string, unknown>;
  list?: (packet: AcpPacket, receive: (packet: unknown) => void) => void;
  delete?: (packet: AcpPacket, receive: (packet: unknown) => void) => void;
} = {}) {
  const sent: { token: string; packet: AcpPacket }[] = [], started: string[] = [], stopped: string[] = [], errors: unknown[] = [];
  const connections = new Map<string, (packet: unknown) => void>();
  const host: CopilotHistoryHost = {
    start: async (token, receive) => {
      await options.startGate;
      started.push(token);
      if (options.startError) throw new Error(options.startError);
      connections.set(token, receive);
      return '/fixture/project';
    },
    send: async (token, packet) => {
      sent.push({ token, packet });
      const receive = connections.get(token)!;
      if (packet.method === 'initialize') receive({ jsonrpc: '2.0', id: packet.id, result: {
        protocolVersion: 1, agentCapabilities: options.capabilities ?? { loadSession: true, sessionCapabilities: { list: {} } },
      } });
      else if (packet.method === 'session/list') {
        if (options.list) options.list(packet, receive);
        else receive({ jsonrpc: '2.0', id: packet.id, result: { sessions: [
          { sessionId: 'saved', cwd: '/fixture/project', title: 'Saved Copilot', updatedAt: '2026-10-16T12:00:00Z' },
          { sessionId: 'other', cwd: '/other/project', title: 'Not this project' },
        ] } });
      }
      else if (packet.method === 'session/delete') {
        if (options.delete) options.delete(packet, receive);
        else receive({ jsonrpc: '2.0', id: packet.id, result: {} });
      }
    },
    stop: async token => {
      stopped.push(token);
      if (options.stopError) throw new Error(options.stopError);
      connections.delete(token);
    },
    error: error => { errors.push(error); },
  };
  return { source: new CopilotSessionHistory('/fixture/project', host), started, stopped, sent, connections, errors, options };
}

test('Copilot discovery reuses one initialized connection, filters exact cwd and owns no conversation', async () => {
  const f = copilotFixture();
  try {
    await Promise.all([f.source.initialize(), f.source.initialize()]);
    const signal = new AbortController().signal;
    const first = await f.source.list({ signal });
    const second = await f.source.list({ signal });
    assert.equal(f.started.length, 1);
    assert.deepEqual(first, second);
    assert.equal(first.entries.length, 1);
    assert.equal(first.entries[0].title, 'Saved Copilot');
    assert.equal(first.entries[0].timestamp, Date.parse('2026-10-16T12:00:00Z'));
    assert.deepEqual(f.sent.map(({ packet }) => packet.method), ['initialize', 'session/list', 'session/list']);
    assert.equal(f.sent.every(({ token }) => token === f.started[0]), true);
  } finally { await f.source.dispose(); }
  assert.deepEqual(f.stopped, f.started);
});

test('cancelled history cannot publish late results or kill the shared discovery connection', async () => {
  let reply!: () => void;
  const f = copilotFixture({ list: (packet, receive) => {
    reply = () => receive({ jsonrpc: '2.0', id: packet.id, result: { sessions: [] } });
  } });
  const controller = new AbortController(), snapshots: SessionHistorySnapshot[] = [];
  try {
    const pending = loadSessionHistory([f.source], controller.signal, snapshot => snapshots.push(snapshot));
    await flush();
    controller.abort();
    await assert.rejects(pending);
    assert.equal(f.stopped.length, 0);
    const count = snapshots.length;
    reply(); await flush();
    assert.equal(snapshots.length, count);
    assert.equal(f.connections.size, 1);
    f.options.list = undefined;
    await f.source.list({ signal: new AbortController().signal });
    assert.equal(f.started.length, 1);
  } finally { await f.source.dispose(); }
});

test('failed Copilot discovery retries only explicitly and never falls back to creating a session', async () => {
  const f = copilotFixture({ startError: 'Missing executable' });
  try {
    await assert.rejects(f.source.initialize(), /Missing executable/);
    await flush();
    assert.equal(f.started.length, 1);
    f.options.startError = undefined;
    await f.source.list({ signal: new AbortController().signal });
    assert.equal(f.started.length, 2);
    assert.equal(f.sent.some(({ packet }) => ['session/new', 'session/load', 'session/prompt'].includes(String(packet.method))), false);
  } finally { await f.source.dispose(); }
});

test('discovery disposal observes a late launch and stops it before settling', async () => {
  let release!: () => void;
  const f = copilotFixture({ startGate: new Promise<void>(resolve => { release = resolve; }) });
  const starting = f.source.initialize();
  const rejected = assert.rejects(starting, /closed/);
  await flush();
  const disposing = f.source.dispose();
  assert.equal(f.stopped.length, 0);
  release();
  await Promise.all([rejected, disposing]);
  assert.deepEqual(f.stopped, f.started);
  assert.equal(f.connections.size, 0);
  assert.equal(f.sent.length, 0);
});

test('failed discovery shutdown retains ownership and blocks replacement until explicit successful stop', async () => {
  const f = copilotFixture();
  await f.source.initialize();
  f.options.stopError = 'Owned child did not exit';
  await assert.rejects(f.source.dispose(), /did not exit/);
  assert.equal(f.started.length, 1);
  assert.equal(f.connections.size, 1);
  f.options.stopError = undefined;
  await f.source.dispose();
  assert.equal(f.connections.size, 0);
  assert.equal(f.started.length, 1);
});

test('Copilot deletion verifies fresh exact-project membership and uses only the advertised agent method', async () => {
  const f = copilotFixture({ capabilities: { loadSession: true, sessionCapabilities: { list: {}, delete: {} } } });
  try {
    assert.equal(f.source.supportsDeletion, false);
    await f.source.initialize();
    assert.equal(f.source.supportsDeletion, true);
    await f.source.deleteSession('saved');
    assert.deepEqual(f.sent.map(({ packet }) => packet.method), ['initialize', 'session/list', 'session/delete']);
    assert.deepEqual(f.sent.at(-1)!.packet.params, { sessionId: 'saved' });
    await assert.rejects(f.source.deleteSession('other'), /no longer listed in this project/);
    assert.equal(f.sent.filter(({ packet }) => packet.method === 'session/delete').length, 1);
  } finally { await f.source.dispose(); }
});

test('Copilot deletion finds paged history but refuses missing, unsupported and uncertain outcomes without retry', async () => {
  const f = copilotFixture({ capabilities: { loadSession: true, sessionCapabilities: { list: {}, delete: {} } },
    list: (packet, receive) => {
      const cursor = (packet.params as { cursor?: string }).cursor;
      receive({ jsonrpc: '2.0', id: packet.id, result: cursor
        ? { sessions: [{ sessionId: 'saved', cwd: '/fixture/project' }] }
        : { sessions: [], nextCursor: 'next' } });
    },
    delete: (_packet, _receive) => { f.source.dispose().catch(error => f.errors.push(error)); },
  });
  try {
    await assert.rejects(f.source.deleteSession('saved'), /not confirmed.*retained.*nothing is retried/s);
    assert.equal(f.sent.filter(({ packet }) => packet.method === 'session/list').length, 2);
    assert.equal(f.sent.filter(({ packet }) => packet.method === 'session/delete').length, 1);
  } finally { await f.source.dispose(); }
  const unsupported = copilotFixture();
  try {
    await assert.rejects(unsupported.source.deleteSession('saved'), /does not advertise/);
    assert.equal(unsupported.sent.some(({ packet }) => packet.method === 'session/delete'), false);
  } finally { await unsupported.source.dispose(); }
});
