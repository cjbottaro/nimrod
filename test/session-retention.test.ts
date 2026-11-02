import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSessionRetention } from '../src/session-retention';
import { SessionDrafts } from '../src/session-drafts';

for (const state of ['saved', 'absent', 'unknown'] as const) test(`retention preserves the adapter's ${state} classification`, async () => {
  assert.equal(await checkSessionRetention({ async check() { return state; }, forget() {} }), state);
});
test('failed discovery is unknown, never native absence or an impediment to Close', async () => {
  assert.equal(await checkSessionRetention({ async check() { throw new Error('SDK unavailable'); }, forget() {} }), 'unknown');
});

for (const key of ['unassigned:never-saved', 'copilot-sdk:"missing"', 'codex:"missing"', 'file:/sessions/missing.jsonl']) {
  test(`discard retires only ${key} and suppresses late draft/attachment writes`, () => {
    const changes: [string, unknown][] = [];
    const library = new SessionDrafts({ drafts: { [key]: { draft: 'Orphan', attachments: [{ id: 'image' }] },
      'file:/sessions/sibling.jsonl': { draft: 'Keep sibling' } } }, undefined, () => {}, (scope, value) => changes.push([scope, value]));
    const retired = library.fork(); retired.select(key); retired.discard();
    retired.write({ draft: 'Late callback', attachments: [{ id: 'late' }] });
    assert.equal(retired.read(), undefined);
    assert.equal(library.select(key), undefined);
    assert.deepEqual(changes, [[key, null]]);
    assert.deepEqual(library.select('file:/sessions/sibling.jsonl'), { draft: 'Keep sibling' });
    assert.deepEqual(library.recoverable(), []);
  });
}
