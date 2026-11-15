import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexSessionHistory } from '../src/codex/session-history';
import { loadSessionHistory } from '../src/session-history';
import type { CodexPacket } from '../src/codex/protocol';
import type { TranscriptLogRecord } from '../src/transcript-logs';
const cwd = '/fixture/codex-history';
const thread = (id: string, directory = cwd) => ({ id, cwd: directory, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'notLoaded' }, name: id, updatedAt: 100 });
function fixture() {
  const sent: CodexPacket[] = [], stopped: string[] = [];
  const listeners = new Map<string, (packet: unknown) => void>();
  const history = new CodexSessionHistory(cwd, {
    start: async (token, receive) => { listeners.set(token, receive); return cwd; },
    write: async (token, packet) => {
      sent.push(packet); const receive = listeners.get(token)!;
      if (packet.method === 'initialize') receive({ id: packet.id, result: { userAgent: 'fixture' } });
      if (packet.method === 'thread/list') {
        const cursor = (packet.params as Record<string, unknown>).cursor;
        receive({ id: packet.id, result: cursor ? { data: [thread('saved')], nextCursor: null } : { data: [thread('foreign', '/other')], nextCursor: 'next' } });
      }
    },
    stop: async token => { stopped.push(token); },
  }, () => {});
  return { history, sent, stopped };
}

test('Codex project catalog continues past a filtered empty page and never creates or prompts a thread', async () => {
  const f = fixture();
  const result = await loadSessionHistory([f.history], new AbortController().signal, () => {});
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].harnessLabel, 'Codex');
  assert.deepEqual(result.entries[0].reference, { kind: 'codex', sessionId: 'saved' });
  assert.equal(result.entries[0].timestamp, 100_000);
  assert.equal(f.sent.filter(packet => packet.method === 'thread/list').length, 2);
  assert.equal(f.sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  await f.history.dispose(); assert.equal(f.stopped.length, 1);
});

test('Codex deletion inventory includes archived descendants and retires an uncertain catalog before guard release', async () => {
  const events: string[] = [], sent: CodexPacket[] = [];
  let receive!: (packet: unknown) => void;
  const row = (id: string, parentThreadId: string | null) => ({ ...thread(id), parentThreadId, forkedFromId: null });
  const history = new CodexSessionHistory(cwd, {
    start: async (_token, listener) => { receive = listener; return cwd; },
    write: async (_token, packet) => {
      sent.push(packet);
      if (packet.method === 'initialize') receive({ id: packet.id, result: { userAgent: 'fixture' } });
      else if (packet.method === 'thread/list') {
        const params = packet.params as Record<string, unknown>;
        assert.equal(params.cwd, undefined); assert.equal((params.sourceKinds as string[]).length, 10);
        receive({ id: packet.id, result: { data: params.archived ? [row('archived-child', 'root')] : [row('root', null), row('exec-child', 'root')], nextCursor: null } });
      } else if (packet.method === 'thread/delete') receive({ id: packet.id, error: { code: -32000, message: 'Partial failure' } });
    },
    stop: async () => { events.push('catalog-exited'); },
    deletion: {
      reserve: async () => { events.push('reserve'); }, stop: async () => { events.push('writers-exited'); },
      release: async () => { assert.ok(events.includes('catalog-exited')); events.push('release'); },
    },
  }, () => { events.push('duplicate-discovery-error'); });
  const tree = await history.previewTree('root', new AbortController().signal);
  assert.ok(tree);
  assert.deepEqual(new Set(tree.ids), new Set(['root', 'exec-child', 'archived-child']));
  await history.reserveDeletion('operation', 'root', tree.ids); await history.stopDeletionOwners('operation');
  await assert.rejects(history.deleteTree('root', () => {})); await history.finishDeletion('operation', true);
  assert.ok(events.indexOf('catalog-exited') < events.indexOf('release')); assert.equal(events.includes('duplicate-discovery-error'), false);
  assert.equal(sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  await history.dispose();
});

function deletionPreviewFixture(options: {
  inventory?: Record<string, unknown>[]; saved?: Record<string, unknown>;
  readError?: { code: number; message: string }; listError?: boolean;
} = {}) {
  const sent: CodexPacket[] = []; let receive!: (packet: unknown) => void;
  const history = new CodexSessionHistory(cwd, {
    start: async (_token, listener) => { receive = listener; return cwd; },
    write: async (_token, packet) => {
      sent.push(packet);
      const params = packet.params as Record<string, unknown>;
      if (packet.method === 'initialize') receive({ id: packet.id, result: { userAgent: 'fixture' } });
      else if (packet.method === 'thread/list') {
        if (options.listError) receive({ id: packet.id, error: { code: -32000, message: 'Catalog inventory unavailable' } });
        else receive({ id: packet.id, result: { data: params.archived ? [] : options.inventory ?? [], nextCursor: null } });
      } else if (packet.method === 'thread/read') {
        assert.equal(params.includeTurns, false);
        if (options.saved) receive({ id: packet.id, result: { thread: options.saved } });
        else receive({ id: packet.id, error: options.readError ?? { code: -32600, message: `thread not loaded: ${params.threadId}` } });
      }
    },
    stop: async () => {},
    deletion: { reserve: async () => {}, stop: async () => {}, release: async () => {} },
  }, () => {});
  return { history, sent };
}

test('retention uses complete native inventory plus exact lookup without entering a deletion transaction', async () => {
  for (const options of [{}, { saved: { ...thread('root'), forkedFromId: null } }, { inventory: [{ ...thread('root'), forkedFromId: null }] }]) {
    const f = deletionPreviewFixture(options);
    try {
      assert.equal(await f.history.retention('root'), 'saved' in options || 'inventory' in options ? 'saved' : 'absent');
      assert.equal(f.sent.some(packet => ['thread/start', 'thread/resume', 'turn/start', 'thread/delete'].includes(String(packet.method))), false);
    } finally { await f.history.dispose(); }
  }
  const f = deletionPreviewFixture({ listError: true });
  try { await assert.rejects(f.history.retention('root'), /inventory unavailable/); }
  finally { await f.history.dispose(); }
});

test('complete deletion inventory plus exact native not-found establishes local-only removal', async () => {
  const f = deletionPreviewFixture();
  try {
    assert.equal(await f.history.previewTree('absent', new AbortController().signal), null);
    assert.deepEqual(f.sent.filter(packet => packet.method === 'thread/list').map(packet => (packet.params as Record<string, unknown>).archived), [false, true]);
    assert.equal(f.sent.filter(packet => packet.method === 'thread/read').length, 1);
    assert.equal(f.sent.some(packet => ['thread/start', 'thread/resume', 'turn/start', 'thread/delete'].includes(String(packet.method))), false);
  } finally { await f.history.dispose(); }
});

test('named saved zero-message root hidden by listing still produces a native deletion tree', async () => {
  const f = deletionPreviewFixture({ saved: { ...thread('hidden-saved'), forkedFromId: null } });
  try {
    const plan = await f.history.previewTree('hidden-saved', new AbortController().signal);
    assert.ok(plan); assert.deepEqual(plan.ids, ['hidden-saved']);
  } finally { await f.history.dispose(); }
});

test('failed lookups, foreign identities and incomplete/ambiguous inventory never establish native absence', async () => {
  for (const options of [
    { listError: true },
    { readError: { code: -32000, message: 'thread not loaded: absent' } },
    { readError: { code: -32600, message: 'thread not loaded: different-id' } },
    { readError: { code: -32600, message: 'Permission denied' } },
    { saved: { ...thread('absent', '/other'), forkedFromId: null } },
    { saved: { ...thread('different-id'), forkedFromId: null } },
    { inventory: [{ ...thread('child'), parentThreadId: 'absent', forkedFromId: null }] },
    { inventory: [{ ...thread('fork'), forkedFromId: 'absent' }] },
  ]) {
    const f = deletionPreviewFixture(options);
    try { await assert.rejects(f.history.previewTree('absent', new AbortController().signal)); }
    finally { await f.history.dispose(); }
  }
});

test('Codex catalog captures and reports unsupported server interactions without creating a conversation', async () => {
  const logs: TranscriptLogRecord[] = [], errors: unknown[] = [], sent: CodexPacket[] = [];
  let receive!: (packet: unknown) => void;
  const history = new CodexSessionHistory(cwd, {
    start: async (_token, listener) => { receive = listener; return cwd; },
    write: async (_token, packet) => { sent.push(packet); if (packet.method === 'initialize') receive({ id: packet.id, result: { userAgent: 'fixture' } }); },
    stop: async () => {},
  }, error => errors.push(error), { transcriptLog: { enabled: true, append: record => logs.push(structuredClone(record)) } });
  await history.initialize();
  receive({ id: 'unsupported', method: 'future/catalogInteraction', params: { native: 'retain' } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.ok(errors.some(error => String(error).includes('future/catalogInteraction')));
  assert.ok(logs.some(log => log.event === 'catalog.receive' && (log.payload as Record<string, unknown>).method === 'future/catalogInteraction'));
  assert.ok(logs.some(log => log.event === 'catalog.response' && (log.payload as Record<string, unknown>).id === 'unsupported'));
  assert.equal(sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  await history.dispose();
});

test('catalog disposal cancels pending daemon setup without waiting for readiness or starting RPC work', async () => {
  let entered!: () => void, rejectStart!: (error: Error) => void;
  const starting = new Promise<void>(resolve => { entered = resolve; });
  const stopped: string[] = [], sent: CodexPacket[] = [];
  const history = new CodexSessionHistory(cwd, {
    start: (_token, _receive) => { entered(); return new Promise<string>((_resolve, reject) => { rejectStart = reject; }); },
    write: async (_token, packet) => { sent.push(packet); },
    stop: async token => { stopped.push(token); rejectStart(new Error('Fixture setup detached')); },
  }, () => {});
  const pending = assert.rejects(history.initialize(), /setup detached/);
  await starting; await history.dispose(); await pending;
  assert.equal(stopped.length, 1);
  assert.equal(sent.length, 0);
});

test('retired catalog callbacks cannot disconnect or stop a replacement daemon client', async () => {
  const listeners: ((packet: unknown) => void)[] = [], disconnects: ((reason: string) => void)[] = [];
  const stopped: string[] = [];
  const history = new CodexSessionHistory(cwd, {
    start: async (_token, receive, disconnected) => { listeners.push(receive); disconnects.push(disconnected); return cwd; },
    write: async (_token, packet) => { if (packet.method === 'initialize') listeners.at(-1)!({ id: packet.id, result: { userAgent: 'fixture' } }); },
    stop: async token => { stopped.push(token); },
  }, () => {});
  await history.initialize(); disconnects[0]('Fixture daemon loss');
  await history.initialize();
  assert.equal(listeners.length, 2);
  disconnects[0]('Late retired disconnect'); listeners[0]({ method: 'thread/closed', params: { threadId: 'foreign' } });
  await Promise.resolve();
  assert.equal(stopped.length, 1);
  await history.initialize(); assert.equal(listeners.length, 2);
  await history.dispose(); assert.equal(stopped.length, 2);
});

test('aborted Codex catalog consumer does not spawn work, disposal does not delete sessions', async () => {
  const f = fixture(), signal = new AbortController(); signal.abort();
  await assert.rejects(f.history.list({ signal: signal.signal }));
  assert.equal(f.sent.length, 0); await f.history.dispose(); assert.equal(f.stopped.length, 0);
});

