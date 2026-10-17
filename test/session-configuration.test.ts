import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationDeferred, ConfigurationSuperseded, SessionConfigurationController, type ConfigurationAvailability } from '../src/session-configuration';
import { ConfigurationTranscript } from '../src/configuration-transcript';

const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function fixture() {
  let availability: ConfigurationAvailability = 'deferred', inFlight = false, publications = 0;
  const values: Record<string, string> = { model: 'a', effort: 'low' };
  const calls: { setting: string; value: string }[] = [], errors: string[] = [];
  let resolve!: () => void, reject!: (error: Error) => void;
  let models = ['a', 'b', 'c'];
  const configuration = new SessionConfigurationController({
    capabilities: desired => [
      { id: 'model', label: 'Model', availability: inFlight ? 'deferred' : availability },
      ...((desired.model ?? values.model) !== 'c' ? [{ id: 'effort', label: 'Thinking level', availability: inFlight ? 'deferred' as const : availability, dependsOn: ['model'] }] : []),
    ],
    get: id => values[id],
    choices: async (id, desired) => (id === 'model' ? models : (desired.model ?? values.model) === 'b' ? ['high'] : ['low', 'high']).map(value => ({ value, label: value })),
    apply: async (setting, value) => {
      if (availability !== 'ready' || inFlight) throw new ConfigurationDeferred();
      inFlight = true; calls.push({ setting, value });
      await new Promise<void>((done, fail) => { resolve = () => { values[setting] = value; inFlight = false; done(); }; reject = error => { inFlight = false; fail(error); }; });
    },
  }, () => { publications++; configuration.update(); }, message => errors.push(message));
  const choose = async (id: string, value: string) => {
    const choice = (await configuration.choices(id)).find(choice => choice.value === value);
    assert.ok(choice); configuration.set(id, choice);
  };
  return { configuration, values, calls, errors, choose, ready: () => { availability = 'ready'; configuration.update(); },
    unavailable: () => { availability = 'unavailable'; configuration.update(); }, resolve: () => resolve(), reject: (error: Error) => reject(error),
    revoke: () => { models = ['a']; }, publications: () => publications };
}

test('deferred intent is latest-wins, uses one operation, and never changes effective getters optimistically', async () => {
  const f = fixture();
  await f.choose('model', 'b');
  const key = f.configuration.operations[0].key;
  assert.equal(f.configuration.operations[0].phase, 'queued');
  assert.equal(f.configuration.get('model'), 'a');
  await f.choose('model', 'c');
  assert.equal(f.configuration.operations.length, 1);
  assert.equal(f.configuration.operations[0].key, key);
  assert.equal(f.configuration.operations[0].text, 'Model: c');
  const before = f.configuration.operations, publications = f.publications();
  f.configuration.update(); await flush();
  assert.equal(f.configuration.operations, before);
  assert.equal(f.publications(), publications, 'unrelated activity does not republish identical progress');
  assert.deepEqual(f.calls, []);
  f.ready(); await flush();
  assert.deepEqual(f.calls, [{ setting: 'model', value: 'c' }]);
  assert.equal(f.configuration.operations[0].phase, 'applying');
  assert.equal(f.configuration.get('model'), 'a');
  f.resolve(); await flush();
  assert.equal(f.configuration.get('model'), 'c');
  assert.equal(f.configuration.operations[0].phase, 'completed');
  assert.deepEqual(f.errors, []);
});

test('a newer choice during an in-flight mutation remains pending and applies serially', async () => {
  const f = fixture(); f.ready();
  await f.choose('model', 'b'); await flush();
  const key = f.configuration.operations[0].key;
  await f.choose('model', 'c'); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.configuration.operations[0].key, key);
  assert.equal(f.configuration.operations[0].text, 'Model: c');
  f.resolve(); await flush();
  assert.deepEqual(f.calls, [{ setting: 'model', value: 'b' }, { setting: 'model', value: 'c' }]);
  assert.equal(f.configuration.get('model'), 'b');
  f.resolve(); await flush();
  assert.equal(f.configuration.get('model'), 'c');
  assert.equal(f.configuration.operations[0].phase, 'completed');
});

test('effort is selected for the desired model, applies after it, and is discarded when that model intent changes', async () => {
  const f = fixture();
  await f.choose('model', 'b');
  assert.deepEqual((await f.configuration.choices('effort')).map(choice => choice.value), ['high']);
  await f.choose('effort', 'high');
  f.ready(); await flush();
  assert.equal(f.calls[0].setting, 'model');
  f.resolve(); await flush();
  assert.deepEqual(f.calls[1], { setting: 'effort', value: 'high' });
  f.resolve(); await flush();
  assert.equal(f.configuration.get('effort'), 'high');
  const next = fixture();
  await next.choose('model', 'b');
  const stale = (await next.configuration.choices('effort'))[0];
  await next.choose('effort', 'high');
  await next.choose('model', 'a');
  assert.throws(() => next.configuration.set('effort', stale), /picker was open/);
  next.ready(); await flush(); next.resolve(); await flush();
  assert.deepEqual(next.calls, [{ setting: 'model', value: 'a' }]);
});

test('revocation, failure and disconnect terminate shimmer without retry or applying to a replacement connection', async () => {
  const revoked = fixture(); await revoked.choose('model', 'b'); revoked.revoke(); revoked.ready(); await flush();
  assert.equal(revoked.calls.length, 0);
  assert.equal(revoked.configuration.operations[0].phase, 'failed');
  assert.equal(revoked.errors.length, 1);
  const failed = fixture(); failed.ready(); await failed.choose('model', 'b'); await flush();
  await failed.choose('model', 'c'); failed.reject(new Error('ambiguous delivery')); await flush();
  failed.configuration.update(); await flush();
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.configuration.operations[0].phase, 'failed');
  assert.equal(failed.errors.length, 1);
  const disconnected = fixture(); await disconnected.choose('model', 'b');
  disconnected.configuration.dispose(); disconnected.ready(); await flush();
  assert.equal(disconnected.calls.length, 0);
  assert.equal(disconnected.configuration.operations[0].phase, 'cancelled');
  await assert.rejects(disconnected.configuration.choices('model'), /unavailable/);
  const active = fixture(); active.ready(); await active.choose('model', 'b'); await flush();
  active.configuration.dispose(); const cancelled = active.configuration.operations;
  active.resolve(); await flush();
  assert.equal(active.configuration.operations, cancelled, 'late completion cannot revive a disposed operation');
});

test('a replacement during concrete pre-dispatch validation suppresses the old mutation rather than dispatching it first', async () => {
  let value = 'a';
  const dispatched: string[] = [], gates: (() => void)[] = [];
  const configuration = new SessionConfigurationController({
    capabilities: () => [{ id: 'model', label: 'Model', availability: 'ready' }], get: () => value,
    choices: async () => ['a', 'b', 'c'].map(value => ({ value, label: value })),
    apply: async (_id, selected, current) => {
      await new Promise<void>(resolve => gates.push(resolve));
      if (!current()) throw new ConfigurationSuperseded();
      dispatched.push(selected); value = selected;
    },
  }, () => {}, message => assert.fail(message));
  const choices = await configuration.choices('model');
  configuration.set('model', choices[1]); await flush();
  configuration.set('model', choices[2]); gates.shift()!(); await flush();
  assert.deepEqual(dispatched, []);
  gates.shift()!(); await flush();
  assert.deepEqual(dispatched, ['c']);
  assert.equal(configuration.operations.length, 1);
  assert.equal(configuration.operations[0].phase, 'completed');
});

test('local operation projection retains row identity, pins pending work, and anchors completed operations without touching native records', () => {
  const transcript = new ConfigurationTranscript();
  const queued = { key: 'configuration:fixture', phase: 'queued' as const, title: 'Model change queued', text: 'Model: b' };
  assert.equal(transcript.sync([queued]).structural, true);
  const native = [{ key: 'native', role: 'assistant', content: 'Native answer' }];
  const projected = transcript.project(native);
  assert.equal(projected[0], native[0]); assert.equal(projected[1].sticky, true);
  const replaced = { ...queued, text: 'Model: c' };
  const changed = transcript.sync([replaced]);
  assert.equal(changed.structural, false);
  assert.equal(changed.rows[0].key, queued.key);
  const completed = { ...replaced, phase: 'completed' as const, title: 'Configuration changed' };
  assert.equal(transcript.sync([completed]).structural, true);
  const done = transcript.project(native);
  const future = { key: 'future', role: 'user', content: 'Next question' };
  const later = transcript.project([...native, future]);
  assert.deepEqual(later.map(row => row.key), ['native', queued.key, 'future']);
  assert.equal(later[1], done[1]);
  assert.deepEqual(native, [{ key: 'native', role: 'assistant', content: 'Native answer' }]);
});
