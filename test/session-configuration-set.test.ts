import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionConfigurationController } from '../src/session-configuration';
import { SessionConfigurationSet } from '../src/session-configuration-set';
import { availableSessionActions } from '../src/session-actions';

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
for (const active of [false, true]) test(`independent configuration owner bypasses ${active ? 'in-flight' : 'idle-only queued'} model work`, async () => {
  let configuration: SessionConfigurationSet, model = 'old', profile = 'default', finishModel!: () => void;
  const calls: string[] = [];
  const modelOwner = new SessionConfigurationController({
    capabilities: () => [{ id: 'model', label: 'Model', availability: active ? 'ready' : 'deferred' }], get: () => model,
    choices: async () => [{ value: 'new', label: 'New' }],
    apply: async (_setting, _value, _current, dispatched) => {
      dispatched(); calls.push('model'); await new Promise<void>(resolve => { finishModel = resolve; }); model = 'new';
    },
  }, () => { void configuration.operations; });
  const secondary = new SessionConfigurationController({
    operationTitle: 'Profile change',
    capabilities: () => [{ id: 'profile', label: 'Profile', availability: 'ready' }], get: () => profile,
    choices: async () => [{ value: 'open', label: 'Harness-defined open policy' }],
    apply: async (_setting, value, _current, dispatched) => { dispatched(); calls.push('profile'); profile = value; },
  }, () => { void configuration.operations; });
  configuration = new SessionConfigurationSet([modelOwner, secondary]);
  configuration.set('model', (await configuration.choices('model'))[0]); await flush();
  configuration.set('profile', (await configuration.choices('profile'))[0]); await flush();
  assert.deepEqual(calls, active ? ['model', 'profile'] : ['profile']);
  assert.equal(configuration.operations[0].phase, active ? 'applying' : 'queued');
  assert.equal(configuration.operations[1].phase, 'completed');
  assert.equal(configuration.operations[1].title, 'Profile change');
  assert.equal(configuration.get('profile'), 'open');
  const operations = configuration.operations;
  configuration.update(); await flush();
  assert.equal(configuration.operations, operations, 'unchanged domains retain publication identity');
  if (active) { finishModel(); await flush(); }
  else assert.equal(configuration.cancel(configuration.operations[0].key), true);
  assert.equal(configuration.operations.at(-1)?.title, 'Profile change');
  configuration.dispose();
});

test('configuration capability does not manufacture a harness-command action', () => {
  const configuration = new SessionConfigurationSet([new SessionConfigurationController({
    capabilities: () => [{ id: 'permissions', label: 'Permissions', availability: 'ready' }],
    get: () => undefined, choices: async () => [], apply: async () => {},
  }, () => {})]);
  const action = availableSessionActions({ actions: { current: () => [], async control() {} }, configuration: { current: () => configuration } }, async () => {}).find(action => action.id === 'permissions');
  assert.equal(action, undefined);
});
