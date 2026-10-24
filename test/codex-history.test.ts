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
  assert.deepEqual(new Set(tree.ids), new Set(['root', 'exec-child', 'archived-child']));
  await history.reserveDeletion('operation', 'root', tree.ids); await history.stopDeletionOwners('operation');
  await assert.rejects(history.deleteTree('root', () => {})); await history.finishDeletion('operation', true);
  assert.ok(events.indexOf('catalog-exited') < events.indexOf('release')); assert.equal(events.includes('duplicate-discovery-error'), false);
  assert.equal(sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  await history.dispose();
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

test('aborted Codex catalog consumer does not spawn work, disposal does not delete sessions', async () => {
  const f = fixture(), signal = new AbortController(); signal.abort();
  await assert.rejects(f.history.list({ signal: signal.signal }));
  assert.equal(f.sent.length, 0); await f.history.dispose(); assert.equal(f.stopped.length, 0);
});

