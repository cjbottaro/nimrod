import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConfigCommand, configCommand } from '../copilot/config-command.mjs';

function fixture() {
  const values: Record<string, unknown> = {
    model: 'small', effortLevel: 'low', defaultMode: 'interactive', contextTier: 'default',
    autoTier: 'balance', defaultPermissionMode: 'manual', memory: true,
    dynamicRetrieval: { mcp: false, skills: true },
  };
  const writes: unknown[] = [];
  const client = {
    rpc: { user: { settings: {
      get: async () => ({ settings: Object.fromEntries(['model', 'effortLevel', 'defaultMode', 'contextTier', 'autoTier',
        'defaultPermissionMode', 'memory', 'dynamicRetrieval', 'commandHistoryMaxSize', 'permissions', 'footer', 'sandbox'].map(key => {
        const present = Object.hasOwn(values, key), value = present ? values[key] : null;
        return [key, { value, default: null, isDefault: !present }];
      })) }),
      set: async ({ settings }: { settings: Record<string, unknown> }) => {
        writes.push(structuredClone(settings));
        for (const [key, value] of Object.entries(settings)) {
          if (value === null) delete values[key]; else values[key] = value;
        }
      },
    } } },
    listModels: async () => [
      { id: 'small', name: 'Fixture small', supportedReasoningEfforts: ['low', 'high'] },
      { id: 'large', name: 'Fixture large', policy: { state: 'enabled' } },
      { id: 'disabled', name: 'Disabled', policy: { state: 'disabled' } },
    ],
  };
  return { client, values, writes };
}

test('config command combines dynamic keys, nested compatibility paths and curated values', async () => {
  const f = fixture();
  const command = await configCommand(f.client);
  assert.equal(command.name, 'config');
  assert.equal(command.kind, 'client');
  assert.equal(command.input.hint, '[key]');
  assert.equal(command.input.valueHint, '[value]');
  assert.ok(command.input.choices.some((choice: { name: string }) => choice.name === 'dynamicRetrieval.mcp'));
  assert.ok(command.input.choices.some((choice: { name: string }) => choice.name === 'footer.showQuota'));
  assert.ok(command.input.choices.some(choice => choice.name === 'permissions.allow'));
  for (const name of ['permissions', 'footer', 'sandbox', 'dynamicRetrieval', 'sandbox.userPolicy.network.proxy.password'])
    assert.equal(command.input.choices.some(choice => choice.name === name), false, `${name} is not an editable leaf`);
  assert.deepEqual(command.input.valueChoices.defaultPermissionMode.map(choice => choice.name), ['manual', 'assisted', 'allow-all']);
  assert.deepEqual(command.configValues.model.map((choice: { id: string }) => choice.id), ['small', 'large']);
  assert.deepEqual(command.configValues.effortLevel.map((choice: { id: string }) => choice.id), ['low', 'high']);
  assert.deepEqual(command.configValues.defaultMode.map((choice: { id: string }) => choice.id), ['interactive', 'plan', 'autopilot']);
});

test('config command writes and confirms top-level and nested free-form values', async () => {
  const f = fixture();
  assert.equal((await applyConfigCommand(f.client, 'memory false')).kind, 'text');
  assert.equal(f.values.memory, false);
  await applyConfigCommand(f.client, 'dynamicRetrieval.mcp true');
  assert.deepEqual(f.values.dynamicRetrieval, { mcp: true, skills: true });
  await applyConfigCommand(f.client, 'commandHistoryMaxSize 75');
  assert.equal(f.values.commandHistoryMaxSize, 75);
  await applyConfigCommand(f.client, 'memory null');
  assert.equal(Object.hasOwn(f.values, 'memory'), false);
  await applyConfigCommand(f.client, 'model LARGE');
  assert.equal(f.values.model, 'large');
  assert.equal(f.values.modelProviderId, null);
  assert.deepEqual(f.writes, [
    { memory: false },
    { dynamicRetrieval: { mcp: true, skills: true } },
    { commandHistoryMaxSize: 75 },
    { memory: null },
    { model: 'large', modelProviderId: null },
  ]);
});

test('config command rejects missing, unknown, malformed and secure-only values before writing', async () => {
  const f = fixture();
  for (const [input, pattern] of [
    ['model', /Usage/],
    ['invented true', /Unknown/],
    ['permissions true', /Unknown/],
    ['defaultMode invented', /advertised by Copilot/],
    ['dynamicRetrieval.mcp {bad', /Invalid JSON/],
    ['sandbox.userPolicy.network.proxy.password secret', /secure configuration UI/],
  ] as const) await assert.rejects(applyConfigCommand(f.client, input), pattern);
  assert.deepEqual(f.writes, []);
});

test('config model uses only public settings get/set and preserves the advertised provider', async () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.client.rpc.user.settings).sort(), ['get', 'set']);
  f.client.listModels = async () => [{ id: 'large', name: 'Fixture large', provider: { id: 'fixture-provider' } }];
  const result = await applyConfigCommand(f.client, 'model LARGE');
  assert.deepEqual(f.writes, [{ model: 'large', modelProviderId: 'fixture-provider' }]);
  assert.equal(result.text, 'Configured model for future Copilot sessions.');
});

test('config command reports SDK write rejection without retrying or reading confirmation', async () => {
  const f = fixture();
  let attempts = 0;
  f.client.rpc.user.settings.set = async () => {
    attempts++;
    f.client.rpc.user.settings.get = async () => { assert.fail('Rejected writes must not read confirmation'); };
    throw new Error('Copilot rejected this value');
  };
  await assert.rejects(applyConfigCommand(f.client, 'model large'), /Copilot rejected this value/);
  assert.equal(attempts, 1);
  assert.equal(f.values.model, 'small');
  assert.deepEqual(f.writes, []);
});

test('config command rejects unconfirmed writes without reporting success or retrying', async () => {
  const f = fixture();
  f.client.rpc.user.settings.set = async ({ settings }) => { f.writes.push(settings); };
  await assert.rejects(applyConfigCommand(f.client, 'model large'), /Copilot did not confirm model/);
  assert.deepEqual(f.writes, [{ model: 'large', modelProviderId: null }]);
});

test('config command does not replay a successful write when confirmation fails', async () => {
  const f = fixture();
  const set = f.client.rpc.user.settings.set;
  f.client.rpc.user.settings.set = async params => {
    await set(params);
    f.client.rpc.user.settings.get = async () => { throw new Error('Settings read failed'); };
  };
  await assert.rejects(applyConfigCommand(f.client, 'model large'), /Settings read failed/);
  assert.deepEqual(f.writes, [{ model: 'large', modelProviderId: null }]);
  assert.equal(f.values.model, 'large');
});
