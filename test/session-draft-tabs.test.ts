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
  assert.equal(restoreComposerState(restored.select('temporary:/project:b')).draft, 'new B');
  assert.equal(restored.last?.sessionId, 'a');
});

test('temporary and demo drafts remain explicitly recoverable after their tabs are gone', () => {
  const library = new SessionDrafts({ drafts: {
    'temporary:/project:a': { draft: 'temporary draft', submission: { id: 'pending', text: 'possibly sent', mode: 'steer', status: 'pending' } },
    'demo:/project:b': { draft: 'demo draft' },
    'file:/sessions/owned.jsonl': { draft: 'persistent draft' },
  } }, null, () => {});
  const sources = library.recoverable();
  assert.deepEqual(sources.map(s => s.key), ['temporary:/project:a', 'demo:/project:b']);
  const restored = restoreComposerState(library.select('unassigned:new', sources[0].key));
  assert.equal(restored.submission?.status, 'unknown');
  assert.equal(restored.draft, 'temporary draft');
  assert.equal(restoreComposerState(library.select(sources[0].key)).draft, 'temporary draft');
});
