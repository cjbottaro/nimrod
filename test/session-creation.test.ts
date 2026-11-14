import assert from 'node:assert/strict';
import test from 'node:test';
import type { HarnessProject } from '../src/harness-contract';
import { creationChoices, creationDefault, readDefaultHarness, supportsCreation } from '../src/session-creation';

function project(id: string, modes: readonly ('saved' | 'temporary')[] = ['saved'], named = false, available = true, ready = true): HarnessProject {
  // Only the discovery ports are exercised: no construction, processes or model calls.
  return { id, label: id, creation: { modes, named }, availability: { available: () => available }, initialization: { ready: () => ready } } as HarnessProject;
}

test('creation discovery uses adapter capabilities and availability, not harness identity', () => {
  const projects = [project('future', ['saved', 'temporary'], true), project('saved-only'),
    project('missing', ['saved', 'temporary'], true, false), project('starting', ['saved'], true, true, false)];
  assert.deepEqual(creationChoices(projects, 'saved').map(p => p.id), ['future', 'saved-only']);
  assert.deepEqual(creationChoices(projects, 'temporary').map(p => p.id), ['future']);
  assert.deepEqual(creationChoices(projects, 'named').map(p => p.id), ['future']);
  assert.equal(supportsCreation(project('temporary-only', ['temporary'], true), 'named'), false);
  assert.equal(creationDefault(projects, 'future', 'named').project, projects[0]);
  for (const id of ['absent', 'missing', 'starting', 'saved-only']) {
    const resolved = creationDefault(projects, id, 'named');
    assert.equal(resolved.project, undefined, 'never silently substitute a different harness');
    assert.match(resolved.notice, /Choose a harness for this session/);
  }
});

test('default harness keeps unavailable/future IDs while rejecting invalid settings', () => {
  assert.equal(readDefaultHarness({}), 'pi');
  assert.equal(readDefaultHarness({ 'sessions.defaultHarness': 'future-harness' }), 'future-harness');
  for (const value of ['', 'Pi', '../pi', 'a'.repeat(65), null, 1, {}, true])
    assert.throws(() => readDefaultHarness({ 'sessions.defaultHarness': value }));
});
