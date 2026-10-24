import assert from 'node:assert/strict';
import test from 'node:test';
import { piSessionLifecycle, type PiSessionLifecycleOwner } from '../src/pi/session-lifecycle';
import { acpSessionLifecycle } from '../src/acp/session-lifecycle';
import { copilotSessionLifecycle, copilotSdkScope } from '../src/copilot/session-lifecycle';
import { CopilotSession } from '../src/copilot/session';
import { parseAcpProfile } from '../src/acp/profiles';
import { PiSession } from '../src/pi/session';
import { PiTransport } from '../src/pi/transport';
import { ownedProcessStop, readSavedSidebarSession, type ConnectSessionOptions, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner, type SessionPersistence } from '../src/session-lifecycle';

function fixture(kind: 'pi' | 'copilot') {
  const owner: PiSessionLifecycleOwner = { mode: 'saved', starting: false, ended: false };
  let gate: ReturnType<SessionLifecycleHost['gate']> = 'ready';
  const connects: ConnectSessionOptions[] = [], stops: string[] = [], disconnected: string[] = [];
  let stop: (token: string) => Promise<void> = async () => {};
  const host: SessionLifecycleHost = {
    connect: async options => { connects.push(options); },
    stop: token => { stops.push(token); return stop(token); },
    gate: () => gate,
  };
  const pi = new PiSession(new PiTransport(async () => {}), {
    publish() {}, changed() {}, choose: async () => undefined, input: async () => undefined,
    confirm: async () => false, copy: async () => {}, openLink: async () => {},
    disconnected: reason => disconnected.push(reason ?? ''),
  }, false);
  const copilot = new CopilotSession(async () => {}, {
    publish() {}, changed() {}, notice() {}, completed() {}, identified() {}, decision: async () => undefined,
    disconnected: reason => disconnected.push(reason),
  });
  const piBackend = { session: pi };
  const copilotBackend: { session: CopilotSession; savedSessionId?: string } = { session: copilot };
  const lifecycle: SessionLifecycle = kind === 'pi'
    ? piSessionLifecycle(() => owner, piBackend, host)
    : copilotSessionLifecycle(() => owner, copilotBackend, host);
  const save = () => {
    if (kind === 'pi') owner.file = { path: '/fixture/session.jsonl', sessionId: 'saved-id', exists: true };
    else copilotBackend.savedSessionId = 'saved-id';
  };
  return { owner, lifecycle, connects, stops, disconnected, save,
    gate: (value: typeof gate) => { gate = value; },
    stop: (operation: typeof stop) => { stop = operation; },
    available: (value: boolean) => {
      pi.state = { ...pi.state, sessionUnavailable: !value };
      copilot.state = { ...copilot.state, sessionUnavailable: !value };
    },
  };
}

for (const kind of ['pi', 'copilot'] as const) {
  test(`${kind}: durable membership is independent of connectivity and survives disconnect`, () => {
    const f = fixture(kind);
    assert.equal(f.lifecycle.identity, undefined);
    f.save();
    const identity = f.lifecycle.identity, key = f.lifecycle.key, draft = f.lifecycle.draftScope;
    assert.ok(identity); assert.ok(key); assert.ok(draft);
    f.available(true);
    assert.equal(f.lifecycle.connection, 'connected');
    f.lifecycle.disconnect('Owned connection closed');
    assert.equal(f.lifecycle.connection, 'disconnected');
    assert.deepEqual(f.lifecycle.identity, identity);
    assert.equal(f.lifecycle.key, key);
    assert.equal(f.lifecycle.draftScope, draft);
    assert.deepEqual(f.disconnected, ['Owned connection closed']);
  });

  test(`${kind}: connection operations target the integration without changing saved membership`, async () => {
    const f = fixture(kind); f.save();
    const identity = f.lifecycle.identity;
    const options = { acceptedAction: true };
    await f.lifecycle.connect(options);
    assert.deepEqual(f.connects, [options]);
    f.owner.ended = true;
    assert.equal(f.lifecycle.eligibility(), 'connectable');
    f.gate('blocked'); assert.equal(f.lifecycle.eligibility(), 'blocked');
    f.gate('unavailable'); assert.equal(f.lifecycle.eligibility(), 'unavailable');
    assert.deepEqual(f.lifecycle.identity, identity);
    f.owner.starting = true;
    assert.equal(f.lifecycle.connection, 'connecting');
  });

  test(`${kind}: stop is token-scoped, deduplicated, observes completion and retries only explicitly after failure`, async () => {
    const f = fixture(kind);
    f.owner.token = 'owned-a';
    let release!: () => void;
    f.stop(() => new Promise(resolve => { release = resolve; }));
    let finished = false;
    const first = f.lifecycle.stop().then(() => { finished = true; });
    const second = f.lifecycle.stop();
    await Promise.resolve();
    assert.equal(finished, false);
    assert.deepEqual(f.stops, ['owned-a']);
    release(); await Promise.all([first, second]);
    await f.lifecycle.stop(); assert.deepEqual(f.stops, ['owned-a']);
    f.owner.token = 'owned-b';
    f.stop(async () => { throw new Error('Could not observe exit'); });
    await assert.rejects(f.lifecycle.stop(), /Could not observe exit/);
    assert.equal(f.owner.token, 'owned-b', 'failed stop cannot clear the ownership reservation');
    f.stop(async () => {});
    await f.lifecycle.stop();
    assert.deepEqual(f.stops, ['owned-a', 'owned-b', 'owned-b']);
  });
}

test('token-bound cleanup deduplicates retired tokens without redirecting to a newer owner', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const stop = ownedProcessStop(async token => { calls.push(token); if (token === 'old') await new Promise<void>(resolve => { release = resolve; }); });
  const old = stop('old');
  await stop('replacement');
  const concurrent = stop('old');
  assert.deepEqual(calls, ['old', 'replacement']);
  release(); await Promise.all([old, concurrent]);
  await stop('old'); await stop('replacement');
  assert.deepEqual(calls, ['old', 'replacement'], 'completed work survives a token change');
});

test('ACP lifecycle needs only connection ownership; persistence consumers need no controller operations', async () => {
  const owner: SessionLifecycleOwner = { starting: false, ended: true };
  const backend = { profile: parseAcpProfile({ name: 'Fixture', command: '/fixture/agent', args: [] }) };
  let stops = 0;
  const lifecycle = acpSessionLifecycle(() => owner, backend, {
    connect: async () => {}, stop: async () => { stops++; }, gate: () => 'ready',
  });
  const persistence: SessionPersistence = lifecycle;
  assert.equal(persistence.identity, undefined);
  assert.equal(persistence.draftScope, undefined);
  assert.equal(lifecycle.eligibility(), 'unavailable');
  await lifecycle.stop();
  assert.equal(stops, 0, 'no token means no owned process to stop');
  lifecycle.disconnect('Not connected');
  assert.equal(persistence.key, undefined);
});

test('saved reference decoding preserves legacy Pi entries and tagged Copilot entries without mixing identities', () => {
  const pi = { path: '/fixture/session.jsonl', sessionId: 'saved-id', name: 'Pi', lastUsed: 100 };
  const copilot = { kind: 'copilot-sdk', sessionId: 'saved-id', name: 'Copilot', lastUsed: 100 };
  assert.deepEqual(readSavedSidebarSession(pi), pi);
  assert.deepEqual(readSavedSidebarSession(copilot), copilot);
  for (const saved of [pi, copilot]) {
    assert.deepEqual(readSavedSidebarSession({ ...saved, pinned: true }), { ...saved, pinned: true });
    for (const pinned of [false, 'true', 1, null, {}]) assert.deepEqual(readSavedSidebarSession({ ...saved, pinned }), saved);
  }
  for (const invalid of [null, [], {}, { ...copilot, kind: '../invalid' }, { ...copilot, sessionId: ' ' }])
    assert.equal(readSavedSidebarSession(invalid), undefined);
  assert.deepEqual(readSavedSidebarSession({ ...copilot, kind: 'fixture-harness' }), { ...copilot, kind: 'fixture-harness' }, 'decoding is structural; registration owns support');
  const p = fixture('pi'), c = fixture('copilot'); p.save(); c.save();
  assert.notEqual(p.lifecycle.key, c.lifecycle.key);
  assert.equal(c.lifecycle.key, copilotSdkScope('saved-id'));
  assert.equal(p.lifecycle.draftScope, 'file:/fixture/session.jsonl');
  p.owner.mode = 'temporary';
  assert.equal(p.lifecycle.identity, undefined, 'a temporary Pi session cannot become persistent because it reports a file');
});
