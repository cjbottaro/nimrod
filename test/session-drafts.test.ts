import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDrafts } from '../src/pi/session-drafts';
import { restoreComposerState } from '../src/pi/webview-state';

test('provisional drafts promote to exact files without importing legacy text', () => {
  let saved: any;
  const store = new SessionDrafts(null, { draft: 'legacy' }, value => { saved = value; });
  assert.equal(store.recoverable()[0].key, 'legacy');
  assert.equal(store.select('unassigned:new'), undefined);
  store.write({ draft: 'new draft', recovered: [{ id: 'r', text: 'queue text', kind: 'steering' }] });
  store.bind('/sessions/exact.jsonl');
  assert.equal(saved.drafts['file:/sessions/exact.jsonl'].draft, 'new draft');
  assert.equal(saved.drafts['unassigned:new'], undefined);
  assert.equal(saved.drafts.legacy.draft, 'legacy');
  assert.equal(store.select('file:/sessions/other.jsonl'), undefined);
  store.write({ draft: 'other' });
  assert.equal((store.select('file:/sessions/exact.jsonl') as any).draft, 'new draft');
  assert.throws(() => store.bind('/sessions/unexpected.jsonl'), /Unexpected session file change/);
});

test('reload keeps pending originals and recovered queues, never treating history as acknowledgement', () => {
  let saved: unknown;
  const store = new SessionDrafts(null, null, value => { saved = structuredClone(value); });
  store.select('unassigned:new');
  store.write({ draft: 'newer', submission: { id: 'send', text: 'original', mode: 'steer', status: 'pending' }, recovered: [{ id: 'r', text: 'queue text', kind: 'steering' }] });
  store.bind('/sessions/a.jsonl');
  store.remember({ path: '/sessions/a.jsonl', cwd: '/project', sessionId: 'id' });
  const restored = new SessionDrafts(saved, null, () => {});
  const composer = restoreComposerState(restored.select('file:/sessions/a.jsonl'));
  assert.equal(composer.draft, 'newer');
  assert.equal(composer.submission?.text, 'original');
  assert.equal(composer.submission?.status, 'unknown');
  assert.equal(composer.recovered[0].text, 'queue text');
  assert.deepEqual(composer.queue, { steering: [], followUp: [], authoritative: false });
  assert.equal(restored.last?.path, '/sessions/a.jsonl');
});

test('unassigned recovery explicitly copies intact uncertainty and preserves its source', () => {
  let saved: any;
  const store = new SessionDrafts({ drafts: { 'unassigned:old': { draft: 'keep', submission: { id: 's', text: 'keep', mode: 'normal', status: 'unknown' } } } }, null, value => { saved = value; });
  const chosen = store.recoverable()[0];
  const state = restoreComposerState(store.select('unassigned:new', chosen.key));
  assert.equal(state.submission?.status, 'unknown');
  store.write(state);
  assert.equal(saved.drafts['unassigned:old'].draft, 'keep');
  assert.equal(saved.drafts['unassigned:new'].draft, 'keep');
});

test('storage failure is surfaced without dropping the in-memory draft or another file draft', () => {
  const store = new SessionDrafts({ drafts: { 'file:/existing': { draft: 'existing' } } }, null, () => { throw new Error('quota'); });
  store.select('unassigned:new');
  assert.throws(() => store.write({ draft: 'retain' }), /quota/);
  assert.equal((store.read() as any).draft, 'retain');
  assert.throws(() => store.bind('/existing'), /already has a local draft/);
  assert.equal((store.read() as any).draft, 'retain');
  assert.equal((store.select('file:/existing') as any).draft, 'existing');
});
