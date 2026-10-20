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
        'defaultPermissionMode', 'memory', 'dynamicRetrieval', 'commandHistoryMaxSize'].map(key => {
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
    ['defaultMode invented', /advertised by Copilot/],
    ['dynamicRetrieval.mcp {bad', /Invalid JSON/],
    ['sandbox.userPolicy.network.proxy.password secret', /secure configuration UI/],
  ] as const) await assert.rejects(applyConfigCommand(f.client, input), pattern);
  assert.deepEqual(f.writes, []);
});
