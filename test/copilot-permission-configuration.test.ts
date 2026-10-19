import assert from 'node:assert/strict';
import test from 'node:test';
import capturedCommand from './fixtures/copilot-permission-command.json' with { type: 'json' };
import { copilotCommands } from '../src/copilot/commands';
import { permissionCommand, createCopilotPermissionConfiguration } from '../src/copilot/permission-configuration';
import { applyPermissionChange, type PermissionConfigurationSession } from '../copilot/permission-configuration.mjs';

function fixture() {
  let mode = 'manual', busy = true, allowed = true;
  const invocations: { name: string; input: string }[] = [];
  const session: PermissionConfigurationSession = { rpc: {
    permissions: { getMode: async () => ({ mode }) },
    commands: {
      list: async () => ({ commands: [{ ...capturedCommand, allowDuringAgentExecution: allowed }] }),
      invoke: async value => { invocations.push(value); mode = 'allow-all'; return { kind: 'completed' }; },
    },
  } };
  return { session, invocations, working: () => busy, idle: () => { busy = false; }, disallowBusy: () => { allowed = false; } };
}

test('captured CLI catalog exposes the native permission action independently from slash commands', async () => {
  const commands = copilotCommands([capturedCommand]);
  assert.equal(permissionCommand(commands), commands[0]);
  const configuration = createCopilotPermissionConfiguration({ commands: () => commands, mode: () => 'manual',
    availability: command => command.allowDuringAgentExecution ? 'ready' : 'deferred', apply: async () => {}, changed() {} });
  assert.equal(configuration.capabilities[0].availability, 'ready');
  assert.equal((await configuration.choices('permissions'))[0].value, 'allow-all');
  const f = fixture();
  await assert.rejects(applyPermissionChange(f.session, 'allow-any', f.working), /Unsupported/);
  assert.equal(f.invocations.length, 0);
});

test('permission mutation invokes the exact native command during work and verifies native mode', async () => {
  const f = fixture();
  const result = await applyPermissionChange(f.session, 'allow-all', f.working);
  assert.deepEqual(result, { outcome: 'applied', mode: 'allow-all' });
  assert.deepEqual(f.invocations, [{ name: 'permissions', input: 'allow-all' }]);
});

test('fresh command metadata can defer before mutation or revoke an advertised choice', async () => {
  const f = fixture(); f.disallowBusy();
  let busyAllowed: boolean | undefined;
  assert.deepEqual(await applyPermissionChange(f.session, 'allow-all', f.working, commands => { busyAllowed = commands[0].allowDuringAgentExecution; }), { outcome: 'deferred' });
  assert.equal(busyAllowed, false); assert.equal(f.invocations.length, 0);
  f.idle(); assert.equal((await applyPermissionChange(f.session, 'allow-all', f.working)).outcome, 'applied');
  f.session.rpc.commands.list = async () => ({ commands: [] });
  await assert.rejects(applyPermissionChange(f.session, 'allow-all', f.working), /no longer advertises/);
  assert.equal(f.invocations.length, 1);
});

for (const failure of ['unsupported-result', 'unconfirmed-mode', 'read-error']) test(`permission ${failure} is uncertain and never causes fallback or replay`, async () => {
  const f = fixture();
  if (failure === 'unsupported-result') f.session.rpc.commands.invoke = async value => { f.invocations.push(value); return { kind: 'agent-prompt', prompt: 'Must never be sent' }; };
  if (failure === 'unconfirmed-mode') f.session.rpc.commands.invoke = async value => { f.invocations.push(value); return { kind: 'text', text: 'Managed policy refused the change' }; };
  if (failure === 'read-error') f.session.rpc.permissions.getMode = async () => { throw new Error('read failed'); };
  const result = await applyPermissionChange(f.session, 'allow-all', f.working);
  assert.equal(result.outcome, 'unknown');
  if (result.outcome === 'unknown' && failure === 'unconfirmed-mode') assert.match(result.details, /Managed policy refused/);
  assert.equal(f.invocations.length, 1);
});
