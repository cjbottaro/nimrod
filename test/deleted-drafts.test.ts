import assert from 'node:assert/strict';
import test from 'node:test';
import { purgeDeletedDrafts } from '../src/pi/session-drafts';

test('confirmed deletion purges file drafts, recovery/submission data and last pointers in closed libraries only', () => {
  const data = new Map<string, string>([
    ['nimrod.sessions.v1:/closed', JSON.stringify({ drafts: { 'file:/deleted': { draft: 'draft', recovered: ['queue'], submission: { status: 'unknown' } }, 'file:/failed': { draft: 'keep' } }, last: { path: '/deleted' }, other: true })],
    ['nimrod.sessions.v1', JSON.stringify({ drafts: { 'file:/deleted': { draft: 'legacy copy' }, legacy: { draft: 'unrelated' } } })],
    ['nimrod.sessions.v1:/corrupt', 'invalid json'],
    ['unrelated', 'unchanged'],
  ]);
  const storage = { get length() { return data.size; }, key(index: number) { return [...data.keys()][index] || null; }, getItem(key: string) { return data.get(key) || null; }, setItem(key: string, value: string) { data.set(key, value); } };
  purgeDeletedDrafts(storage, ['/deleted']);
  const library = JSON.parse(data.get('nimrod.sessions.v1:/closed')!);
  assert.deepEqual(library, { drafts: { 'file:/failed': { draft: 'keep' } }, other: true });
  assert.deepEqual(JSON.parse(data.get('nimrod.sessions.v1')!).drafts, { legacy: { draft: 'unrelated' } });
  assert.equal(data.get('nimrod.sessions.v1:/corrupt'), 'invalid json'); assert.equal(data.get('unrelated'), 'unchanged');
});
