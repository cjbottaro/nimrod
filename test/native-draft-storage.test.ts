import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDrafts } from '../src/pi/session-drafts';
import { restoreComposerState } from '../src/pi/webview-state';

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
