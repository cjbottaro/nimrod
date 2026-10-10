import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionConnection, type ConnectionEligibility } from '../src/session-connection';

function fixture() {
  type Session = { id: string; eligibility: ConnectionEligibility };
  const a: Session = { id: 'a', eligibility: 'connectable' }, b: Session = { id: 'b', eligibility: 'connectable' };
  let selected: Session | undefined = a;
  let connect: (target: Session) => Promise<void> = async target => { target.eligibility = 'connected'; };
  const calls: Session[] = [], errors: unknown[] = [];
  const connection = new SessionConnection<Session>({
    selected: () => selected,
    eligibility: target => target.eligibility,
    connect: target => { calls.push(target); return connect(target); },
    failed: (_, error) => { errors.push(error); },
  });
  return { a, b, calls, errors, connection, select: (target: Session | undefined) => { selected = target; },
    connect: (operation: typeof connect) => { connect = operation; } };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };

test('connection requests do not depend on navigation intent; connected/unavailable/empty selections do nothing', async () => {
  const f = fixture();
  f.connection.request(); await settled();
  assert.deepEqual(f.calls, [f.a]);
  f.connection.request(); f.connection.barriersChanged();
  f.b.eligibility = 'unavailable'; f.select(f.b); f.connection.request();
  f.select(undefined); f.connection.request();
  assert.deepEqual(f.calls, [f.a]);
});

test('feature-independent barriers defer only the latest selected target until it becomes connectable', async () => {
  const f = fixture(); f.a.eligibility = f.b.eligibility = 'blocked';
  f.connection.request();
  f.connection.barriersChanged(); f.connection.barriersChanged();
  assert.deepEqual(f.calls, []);
  f.select(f.b); f.connection.request();
  f.a.eligibility = 'connectable'; f.connection.barriersChanged();
  assert.deepEqual(f.calls, [], 'an old target becoming ready never steals selection');
  f.b.eligibility = 'connectable'; f.connection.barriersChanged(); await settled();
  f.connection.barriersChanged(); f.connection.barriersChanged();
  assert.deepEqual(f.calls, [f.b]);
});

test('hidden/removed selections invalidate a deferred target; reappearing alone cannot resurrect the request', () => {
  const f = fixture(); f.a.eligibility = 'blocked'; f.connection.request();
  f.select(undefined); f.connection.barriersChanged();
  f.select(f.a); f.a.eligibility = 'connectable'; f.connection.barriersChanged();
  assert.deepEqual(f.calls, []);
  f.connection.request(); assert.deepEqual(f.calls, [f.a]);
});

test('quarantine or independent connection satisfies/cancels deferral without launching', () => {
  for (const state of ['unavailable', 'connected'] as const) {
    const f = fixture(); f.a.eligibility = 'blocked'; f.connection.request();
    f.a.eligibility = state; f.connection.barriersChanged();
    f.a.eligibility = 'connectable'; f.connection.barriersChanged();
    assert.deepEqual(f.calls, [], `${state}: no latent request survives`);
  }
});

test('in-flight connection is deduplicated independently of shell lifecycle flags, without blocking other targets', async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.connect(async () => { await gate; });
  f.connection.request(); f.connection.request(); f.connection.barriersChanged();
  f.select(f.b); f.connection.request(); f.select(f.a); f.connection.request();
  assert.deepEqual(f.calls, [f.a, f.b]);
  release(); await settled();
  f.connection.barriersChanged(); assert.deepEqual(f.calls, [f.a, f.b], 'completion is not a retry signal');
});

test('failed connection reports once and waits for another explicit selection request rather than retrying on gate changes', async () => {
  const f = fixture(), error = new Error('Fixture launch failure');
  f.connect(async () => { throw error; });
  f.connection.request(); await settled();
  f.connection.barriersChanged(); f.connection.barriersChanged();
  assert.deepEqual(f.calls, [f.a]); assert.deepEqual(f.errors, [error]);
  f.connection.request(); await settled();
  assert.deepEqual(f.calls, [f.a, f.a]); assert.deepEqual(f.errors, [error, error]);
});
