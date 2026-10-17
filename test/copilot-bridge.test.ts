import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import test from 'node:test';

function bridge(mode = 'interactive') {
  const child = spawn(process.execPath, ['--import', './test/fixtures/copilot-sdk-register.mjs', 'copilot/bridge.mjs', '/fixture/copilot', '/fixture/project'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NIMROD_FIXTURE_COPILOT_MODE: mode } });
  const packets: Record<string, any>[] = [], pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  let stderr = '', sequence = 0;
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    const packet = JSON.parse(line); packets.push(packet);
    if (packet.kind !== 'result') return;
    const request = pending.get(packet.id); pending.delete(packet.id);
    if (packet.error) request?.reject(new Error(packet.error)); else request?.resolve(packet.result);
  });
  child.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => {
    for (const request of pending.values()) request.reject(new Error(`Offline bridge exited: ${stderr}`));
    pending.clear(); resolve(code);
  }));
  return {
    packets,
    request(method: string, parameters: Record<string, unknown> = {}): Promise<any> {
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ ...parameters, id, method })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
      try { assert.equal(await exited, 0, stderr); } finally { clearTimeout(deadline); }
    },
  };
}
test('production SDK bridge loads only exact project members and disconnects without deleting', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    assert.equal((await f.request('initialize')).version, '1.0.98');
    assert.deepEqual((await f.request('list')).map((session: { sessionId: string }) => session.sessionId), ['fixture-sdk']);
    await assert.rejects(f.request('connect', { sessionId: 'outside' }), /Nothing was loaded or deleted/);
    await f.request('connect', { sessionId: 'fixture-sdk' });
    const connected = f.packets.find(packet => packet.kind === 'connected')!;
    assert.equal(connected.sessionId, 'fixture-sdk');
    assert.equal(connected.events[1].data.content, 'Saved SDK answer');
    assert.ok(f.packets.findIndex(packet => packet.kind === 'identified') < f.packets.indexOf(connected));
    assert.equal(f.packets.some(packet => packet.kind === 'permission' || packet.kind === 'input'), false);
    assert.equal((await f.request('configure', { model: 'small', effort: 'high' })).reasoningEffort, 'high');
    await assert.rejects(f.request('delete', { sessionId: 'fixture-sdk' }), /history-only/);
  } finally { await f.close(); }
});
test('unsupported SDK mode retains the exact identity without prompting or changing mode', { timeout: 5000 }, async () => {
  const f = bridge('plan');
  try {
    await f.request('initialize');
    await assert.rejects(f.request('connect', { sessionId: 'fixture-sdk' }), /mode "plan" is not supported/);
    assert.equal(f.packets.find(packet => packet.kind === 'identified')?.sessionId, 'fixture-sdk');
    assert.equal(f.packets.some(packet => packet.kind === 'connected' || packet.kind === 'event'), false);
  } finally { await f.close(); }
});
test('production SDK discovery deletes only through the supported API and never recreates a missing ID', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize');
    await assert.rejects(f.request('delete', { sessionId: 'outside' }), /Nothing was loaded or deleted/);
    await f.request('delete', { sessionId: 'fixture-sdk' });
    assert.deepEqual(await f.request('list'), []);
    await assert.rejects(f.request('connect', { sessionId: 'fixture-sdk' }), /Nothing was loaded or deleted/);
    assert.equal(f.packets.some(packet => packet.kind === 'connected'), false);
  } finally { await f.close(); }
});
