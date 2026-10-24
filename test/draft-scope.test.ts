import assert from 'node:assert/strict';
import test from 'node:test';
import vectors from './fixtures/draft-scopes.json';
import { isSavedDraftScope, isPersistentDraftScope, savedDraftScope } from '../src/draft-scope';
import { SessionDrafts } from '../src/session-drafts';
import { NativeDrafts, type NativeDraftRecord } from '../src/native-drafts';
import { SessionConnection } from '../src/session-connection';
import type { SessionConnectivity, SessionPersistence } from '../src/session-lifecycle';

for (const vector of vectors) test(`draft scope grammar: ${vector.key}`, () => {
  assert.equal(isSavedDraftScope(vector.key), vector.saved);
  assert.equal(isPersistentDraftScope(vector.key), vector.persistent);
});

test('scope construction preserves existing encodings, reserves local scopes and bounds native UTF-8 bytes', () => {
  assert.equal(savedDraftScope('codex', 'thread'), 'codex:"thread"');
  assert.equal(savedDraftScope('copilot-sdk', 'opaque:/id'), 'copilot-sdk:"opaque:/id"');
  assert.notEqual(savedDraftScope('fixture', 'a:b'), savedDraftScope('fixture', 'a%3Ab'));
  for (const reserved of ['file', 'unassigned', 'temporary', 'demo', 'legacy', '../fixture', 'Fixture'])
    assert.throws(() => savedDraftScope(reserved, 'id'));
  assert.throws(() => savedDraftScope('fixture', ''));
  assert.throws(() => savedDraftScope('fixture', '☃'.repeat(11000)));
  assert.equal(isPersistentDraftScope(`file:${'☃'.repeat(11000)}`), false);
});

test('unknown harness connects through the shared coordinator and binds, stages, restores and deletes its actual draft', async () => {
  const records = new Map<string, NativeDraftRecord>(), staged: string[] = [], errors: unknown[] = [];
  const native = () => new NativeDrafts('/fixture', error => errors.push(error), {
    load: async () => [...records.values()],
    stage: async (_project, record) => { records.set(record.key, structuredClone(record)); staged.push(record.key); },
    flush: async () => {},
  });
  const writer = native(); await writer.load();
  const library = new SessionDrafts(undefined, undefined, () => { throw new Error('whole-library writes forbidden'); }, (key, value) => writer.change(key, value));
  const drafts = library.fork(), sibling = library.fork();
  drafts.select('unassigned:new'); drafts.write({ draft: 'Never send this automatically' });
  sibling.select(savedDraftScope('fixture-harness', 'sibling')); sibling.write({ draft: 'Other draft' });
  let scope: string | undefined, state: SessionConnectivity['connection'] = 'disconnected', connects = 0, stops = 0;
  const port: SessionConnectivity & Pick<SessionPersistence, 'draftScope'> = {
    label: 'Unknown fixture harness',
    get draftScope() { return scope; }, get connection() { return state; },
    eligibility: () => state === 'connected' ? 'connected' : 'connectable',
    connect: async () => {
      connects++; state = 'connecting';
      await Promise.resolve();
      const identity = savedDraftScope('fixture-harness', 'opaque:/id:☃');
      drafts.bindScope(identity); scope = identity; state = 'connected';
    },
    stop: async () => { stops++; },
    disconnect: () => { state = 'disconnected'; },
  };
  const coordinator = new SessionConnection({ selected: () => port, eligibility: target => target.eligibility(),
    connect: target => target.connect({ acceptedAction: true }), failed: (_target, error) => errors.push(error) });
  coordinator.request(); coordinator.request();
  // Flush staging after the actual connection continuation has bound its scope.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await writer.flush();
  assert.equal(port.connection, 'connected'); assert.equal(connects, 1);
  assert.deepEqual(drafts.read(), { draft: 'Never send this automatically' });
  assert.ok(staged.includes(port.draftScope!));
  assert.equal(records.get('unassigned:new')?.value, null);
  assert.deepEqual(sibling.read(), { draft: 'Other draft' });
  await port.stop(); port.disconnect('Closed by user');
  assert.equal(stops, 1); assert.ok(port.draftScope);
  const restoredWriter = native();
  const restored = new SessionDrafts({ drafts: await restoredWriter.load() }, undefined, () => {}, (key, value) => restoredWriter.change(key, value));
  restored.select(port.draftScope!);
  assert.deepEqual(restored.read(), { draft: 'Never send this automatically' });
  restored.deleteScope(port.draftScope!); await restoredWriter.flush();
  assert.equal(records.get(port.draftScope!)?.value, null);
  assert.deepEqual(records.get(savedDraftScope('fixture-harness', 'sibling'))?.value, { draft: 'Other draft' });
  assert.deepEqual(errors, []);
});
