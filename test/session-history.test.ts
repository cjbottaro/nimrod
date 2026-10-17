import assert from 'node:assert/strict';
import test from 'node:test';
import { PiSessionHistory } from '../src/pi/session-history';
import { loadSessionHistory, type SessionHistory, type SessionHistoryPage, type SessionHistorySnapshot } from '../src/session-history';
import { savedSessionKey, resolveSessionListEntry, type SessionListEntry } from '../src/session-list';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const entry = (id: string): SessionListEntry => {
  const reference = { kind: 'copilot-sdk' as const, sessionId: id };
  return { key: savedSessionKey(reference), reference, title: id, harnessLabel: 'Copilot', open: false, status: 'closed' };
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

