import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexSessionHistory } from '../src/codex/session-history';
import { loadSessionHistory } from '../src/session-history';
import { codexSessionDeletion } from '../src/codex/session-deletion';
import type { CodexPacket } from '../src/codex/protocol';
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

test('aborted Codex catalog consumer does not spawn work, disposal does not delete sessions', async () => {
  const f = fixture(), signal = new AbortController(); signal.abort();
  await assert.rejects(f.history.list({ signal: signal.signal }));
  assert.equal(f.sent.length, 0); await f.history.dispose(); assert.equal(f.stopped.length, 0);
});

test('recursive Codex deletion is explicitly unavailable rather than pretending to remove one session', async () => {
  const source = codexSessionDeletion();
  assert.equal(source.operation({ kind: 'copilot-sdk', sessionId: 'same' }, 'Same'), undefined);
  const operation = source.operation({ kind: 'codex', sessionId: 'same' }, 'Same')!;
  assert.equal(operation.supported, false); assert.equal(operation.available(), false);
  assert.match(operation.unavailableReason!, /descendant/);
  await assert.rejects(operation.run(), /descendant/);
});
