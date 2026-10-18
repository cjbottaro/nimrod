import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPermissionChange, type PermissionConfigurationSession } from '../copilot/permission-configuration.mjs';

function fixture() {
  let mode = 'manual', busy = true, allowed = true;
  const invocations: { name: string; input: string }[] = [];
  const session: PermissionConfigurationSession = { rpc: {
    permissions: { getMode: async () => ({ mode }) },
    commands: {
      list: async () => ({ commands: [{ name: 'permissions', kind: 'builtin', allowDuringAgentExecution: allowed, input: { choices: [{ name: 'allow-any' }] } }] }),
      invoke: async value => { invocations.push(value); mode = 'allow-all'; return { kind: 'completed' }; },
    },
  } };
  return { session, invocations, working: () => busy, idle: () => { busy = false; }, disallowBusy: () => { allowed = false; } };
}

test('permission mutation invokes the exact native command during work and verifies native mode', async () => {
  const f = fixture();
  const result = await applyPermissionChange(f.session, 'allow-any', f.working);
  assert.deepEqual(result, { outcome: 'applied', mode: 'allow-all' });
  assert.deepEqual(f.invocations, [{ name: 'permissions', input: 'allow-any' }]);
});

test('fresh command metadata can defer before mutation or revoke an advertised choice', async () => {
  const f = fixture(); f.disallowBusy();
  let busyAllowed: boolean | undefined;
  assert.deepEqual(await applyPermissionChange(f.session, 'allow-any', f.working, commands => { busyAllowed = commands[0].allowDuringAgentExecution; }), { outcome: 'deferred' });
  assert.equal(busyAllowed, false); assert.equal(f.invocations.length, 0);
  f.idle(); assert.equal((await applyPermissionChange(f.session, 'allow-any', f.working)).outcome, 'applied');
  f.session.rpc.commands.list = async () => ({ commands: [] });
  await assert.rejects(applyPermissionChange(f.session, 'allow-any', f.working), /no longer advertises/);
  assert.equal(f.invocations.length, 1);
});

for (const failure of ['unsupported-result', 'unconfirmed-mode', 'read-error']) test(`permission ${failure} is uncertain and never causes fallback or replay`, async () => {
  const f = fixture();
  if (failure === 'unsupported-result') f.session.rpc.commands.invoke = async value => { f.invocations.push(value); return { kind: 'agent-prompt', prompt: 'Must never be sent' }; };
  if (failure === 'unconfirmed-mode') f.session.rpc.commands.invoke = async value => { f.invocations.push(value); return { kind: 'text', text: 'Managed policy refused the change' }; };
  if (failure === 'read-error') f.session.rpc.permissions.getMode = async () => { throw new Error('read failed'); };
  const result = await applyPermissionChange(f.session, 'allow-any', f.working);
  assert.equal(result.outcome, 'unknown');
  if (result.outcome === 'unknown' && failure === 'unconfirmed-mode') assert.match(result.details, /Managed policy refused/);
  assert.equal(f.invocations.length, 1);
});
