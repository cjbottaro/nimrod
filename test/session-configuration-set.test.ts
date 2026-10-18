import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionConfigurationController } from '../src/session-configuration';
import { SessionConfigurationSet } from '../src/session-configuration-set';
import { sessionActions } from '../src/session-backend';

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
for (const active of [false, true]) test(`independent permission configuration bypasses ${active ? 'in-flight' : 'idle-only queued'} model work`, async () => {
  let configuration: SessionConfigurationSet, model = 'old', permission = 'manual', finishModel!: () => void;
  const calls: string[] = [];
  const modelOwner = new SessionConfigurationController({
    capabilities: () => [{ id: 'model', label: 'Model', availability: active ? 'ready' : 'deferred' }], get: () => model,
    choices: async () => [{ value: 'new', label: 'New' }],
    apply: async (_setting, _value, _current, dispatched) => {
      dispatched(); calls.push('model'); await new Promise<void>(resolve => { finishModel = resolve; }); model = 'new';
    },
  }, () => { void configuration.operations; });
  const permissions = new SessionConfigurationController({
    operationTitle: 'Permission change',
    capabilities: () => [{ id: 'permissions', label: 'Permissions', availability: 'ready' }], get: () => permission,
    choices: async () => [{ value: 'open', label: 'Harness-defined open policy' }],
    apply: async (_setting, value, _current, dispatched) => { dispatched(); calls.push('permissions'); permission = value; },
  }, () => { void configuration.operations; });
  configuration = new SessionConfigurationSet([modelOwner, permissions]);
  configuration.set('model', (await configuration.choices('model'))[0]); await flush();
  configuration.set('permissions', (await configuration.choices('permissions'))[0]); await flush();
  assert.deepEqual(calls, active ? ['model', 'permissions'] : ['permissions']);
  assert.equal(configuration.operations[0].phase, active ? 'applying' : 'queued');
  assert.equal(configuration.operations[1].phase, 'completed');
  assert.equal(configuration.operations[1].title, 'Permission change');
  assert.equal(configuration.get('permissions'), 'open');
  const operations = configuration.operations;
  configuration.update(); await flush();
  assert.equal(configuration.operations, operations, 'unchanged domains retain publication identity');
  if (active) { finishModel(); await flush(); }
  else assert.equal(configuration.cancel(configuration.operations[0].key), true);
  assert.equal(configuration.operations.at(-1)?.title, 'Permission change');
  configuration.dispose();
});

test('permission actions depend on the consumer capability, not a Copilot branch', () => {
  const configuration = new SessionConfigurationSet([new SessionConfigurationController({
    capabilities: () => [{ id: 'permissions', label: 'Permissions', availability: 'ready' }],
    get: () => undefined, choices: async () => [], apply: async () => {},
  }, () => {})]);
  // A minimal session stand-in exercises the existing Pi composition branch:
  // the shared permission contribution must not require a CopilotSession.
  const session = { configuration } as unknown as import('../src/pi/session').PiSession;
  const action = sessionActions({ backend: { kind: 'pi', session } }).find(action => action.id === 'permissions');
  assert.equal(action?.configurationSetting, 'permissions');
});
