import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDrafts } from '../src/pi/session-drafts';
import { restoreComposerState } from '../src/pi/webview-state';

test('tab selections share a library without overwriting sibling drafts or resume metadata', () => {
  let saved: unknown;
  const library = new SessionDrafts(null, null, value => { saved = structuredClone(value); });
  const a = library.fork(), b = library.fork();
  a.select('unassigned:a'); b.select('temporary:/project:b');
  a.write({ draft: 'A' }); b.write({ draft: 'B' });
  a.bind('/sessions/a.jsonl');
  a.remember({ path: '/sessions/a.jsonl', cwd: '/project', sessionId: 'a' });
  b.write({ draft: 'new B' });
  assert.equal(restoreComposerState(a.read()).draft, 'A');
  const restored = new SessionDrafts(saved, null, () => {});
  assert.equal(restoreComposerState(restored.select('file:/sessions/a.jsonl')).draft, 'A');
  assert.equal(restoreComposerState(b.read()).draft, 'new B');
  assert.equal(restored.select('temporary:/project:b'), undefined, 'temporary siblings do not survive restore');
  assert.equal(restored.last?.sessionId, 'a');
});

test('temporary and demo drafts are not recoverable after their tabs are gone', () => {
  const library = new SessionDrafts({ drafts: {
    'temporary:/project:a': { draft: 'temporary draft', submission: { id: 'pending', text: 'possibly sent', mode: 'steer', status: 'pending' } },
    'demo:/project:b': { draft: 'demo draft' },
    'file:/sessions/owned.jsonl': { draft: 'persistent draft' },
  } }, null, () => {});
  assert.deepEqual(library.recoverable(), []);
  assert.equal(library.select('temporary:/project:a'), undefined);
  assert.equal(library.select('demo:/project:b'), undefined);
  assert.equal(restoreComposerState(library.select('file:/sessions/owned.jsonl')).draft, 'persistent draft');
});
