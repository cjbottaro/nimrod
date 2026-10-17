import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDrafts } from '../src/pi/session-drafts';
import { restoreComposerState } from '../src/pi/webview-state';
import { copilotSessionScope } from '../src/acp/profiles';

test('native provisional promotion stages the saved draft and tombstones the old scope', () => {
  const changes: unknown[] = [];
  const drafts = new SessionDrafts(undefined, undefined, () => { throw new Error('whole-library persistence forbidden'); },
    (key, value) => changes.push([key, value]));
  drafts.select('unassigned:fixture');
  const state = { draft: 'newer', submission: { id: 's', text: 'original', mode: 'steer', status: 'pending' } };
  drafts.write(state); drafts.bind('/session');
  assert.deepEqual(changes, [['unassigned:fixture', state], ['file:/session', state], ['unassigned:fixture', null]]);
  assert.equal(Object.hasOwn(restoreComposerState(drafts.read()), 'submission'), false);
  assert.equal(restoreComposerState(drafts.read()).draft, 'newer');
  drafts.deleteFile('/session');
  assert.deepEqual(changes.at(-1), ['file:/session', null]);
});

test('Copilot draft identity is project-library scoped, distinct from Pi and promoted without whole-library writes', () => {
  const changes: unknown[] = [];
  const store = new SessionDrafts(undefined, undefined, () => { throw new Error('whole-library persistence forbidden'); },
    (key, value) => changes.push([key, value]));
  const scope = copilotSessionScope('opaque:/id');
  store.select('unassigned:new');
  store.write({ draft: 'Keep this draft' });
  store.bindScope(scope);
  assert.deepEqual(changes.slice(-2), [[scope, { draft: 'Keep this draft' }], ['unassigned:new', null]]);
  assert.equal(restoreComposerState(store.read()).draft, 'Keep this draft');
  store.discardTemporary();
  assert.equal(restoreComposerState(store.read()).draft, 'Keep this draft', 'Close does not discard saved Copilot drafts');
  assert.throws(() => store.bindScope(copilotSessionScope('another-id')), /Unexpected session file change/);
  assert.notEqual(scope, 'file:opaque:/id');
  assert.notEqual(copilotSessionScope('a:b'), copilotSessionScope('a%3Ab'));
});

test('empty provisional Copilot promotion never stages an undefined draft', () => {
  const changes: unknown[] = [];
  const store = new SessionDrafts(undefined, undefined, () => {}, (key, value) => changes.push([key, value]));
  store.select('unassigned:empty');
  store.bindScope(copilotSessionScope('saved-id'));
  assert.deepEqual(changes, [['unassigned:empty', null]]);
});

test('confirmed Copilot removal tombstones only its saved scope, including a closed draft', () => {
  const scope = copilotSessionScope('deleted'), sibling = copilotSessionScope('retained');
  const changes: unknown[] = [];
  const store = new SessionDrafts({ drafts: { [scope]: { draft: 'Remove me' }, [sibling]: { draft: 'Keep me' },
    'file:/pi': { draft: 'Pi draft' } } }, undefined,
  () => { throw new Error('whole-library persistence forbidden'); }, (key, value) => changes.push([key, value]));
  store.deleteScope(scope);
  assert.deepEqual(changes, [[scope, null]]);
  assert.equal(store.select(scope), undefined);
  assert.deepEqual(store.select(sibling), { draft: 'Keep me' });
  assert.deepEqual(store.select('file:/pi'), { draft: 'Pi draft' });
  assert.throws(() => store.deleteScope('unassigned:wrong'), /Invalid saved draft scope/);
});
