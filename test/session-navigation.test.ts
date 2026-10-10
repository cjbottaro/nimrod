import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionNavigation, SESSION_VIEWS, type SelectionIntent } from '../src/session-navigation';

interface Session { id: string; lastUsed: number; attention: boolean; working: boolean; connected: boolean; }
const session = (id: string, lastUsed = 0): Session => ({ id, lastUsed, attention: false, working: false, connected: false });
const model = () => new SessionNavigation<Session>({ needsAttention: s => s.attention, isWorking: s => s.working, isConnected: s => s.connected });
const ids = (sessions: readonly Session[]) => sessions.map(s => s.id);

function assertTraversal(navigation: SessionNavigation<Session>): void {
  const displayed = navigation.snapshot('all').visible;
  assert.deepEqual(displayed, navigation.all());
  for (const [index, current] of displayed.entries()) {
    assert.equal(navigation.adjacent(current, 1), displayed[(index + 1) % displayed.length]);
    assert.equal(navigation.adjacent(current, -1), displayed[(index + displayed.length - 1) % displayed.length]);
  }
}

test('canonical projection and both traversal directions remain identical through membership and recency changes', () => {
  // Deterministic exhaustive small layouts, including legacy timestamps and ties.
  for (const a of [0, 1, 10]) for (const b of [0, 1, 10]) for (const c of [0, 1, 10]) {
    const navigation = model(), sessions = [session('a', a), session('b', b), session('c', c)];
    for (const s of sessions) { navigation.add(s); assertTraversal(navigation); }
    const openOrder = ids(navigation.open());
    assert.deepEqual(ids(navigation.all()), ids([...sessions].sort((left, right) => right.lastUsed - left.lastUsed)));
    sessions[0].lastUsed = navigation.nextRecency(1); assertTraversal(navigation);
    assert.equal(navigation.all()[0], sessions[0]);
    assert.deepEqual(ids(navigation.open()), openOrder, 'recency never mutates stable lifecycle/storage order');
    for (const s of [sessions[1], sessions[0], sessions[2]]) { navigation.remove(s); assertTraversal(navigation); }
    assert.equal(navigation.adjacent(undefined, 1), undefined);
  }
});

test('projections isolate inbox arrival, Working recency, selected retention and overlapping counts', () => {
  const navigation = model(), a = session('a', 1), b = session('b', 3), c = session('c', 2);
  [a, b, c].forEach(s => navigation.add(s));
  b.attention = true; navigation.snapshot('all');
  a.attention = true; a.working = true; b.working = true;
  assert.deepEqual(ids(navigation.snapshot('unread').visible), ['b', 'a']);
  assert.deepEqual(ids(navigation.snapshot('working').visible), ['b', 'a']);
  a.lastUsed = navigation.nextRecency(10);
  assert.deepEqual(ids(navigation.snapshot('unread').visible), ['b', 'a'], 'prompt recency cannot reorder inbox');
  assert.deepEqual(ids(navigation.snapshot('working').visible), ['a', 'b']);
  assert.deepEqual(navigation.counts(), { all: 3, unread: 2, working: 2 });
  a.working = false;
  assert.deepEqual(ids(navigation.snapshot('working', a).visible), ['a', 'b']);
  a.attention = false;
  assert.deepEqual(ids(navigation.snapshot('unread', a).visible), ['b', 'a']);
  assert.deepEqual(navigation.counts(), { all: 3, unread: 1, working: 1 });
  assert.deepEqual(ids(navigation.snapshot('working', b).visible), ['b']);
  assert.deepEqual(ids(navigation.snapshot('unread', b).visible), ['b']);
  assertTraversal(navigation);
  // Scope-specific focus navigation must follow the provided visible projection.
  const unread = navigation.snapshot('unread').visible;
  assert.equal(navigation.adjacent(b, 1, unread), b);
  const snapshot = navigation.snapshot('all'); navigation.remove(b);
  assert.ok(snapshot.all.includes(b), 'pre-removal snapshots keep their order for cleanup');
  assert.deepEqual(ids(navigation.snapshot('unread', b).visible), [], 'closed selection never stays retained');
});

test('selection intents govern presentation, not connection policy, without mutating recency', () => {
  const navigation = model(), a = session('a', 2), b = session('b', 1);
  navigation.add(a); navigation.add(b); b.attention = true;
  for (const view of SESSION_VIEWS) for (const intent of ['explicit', 'row', 'restore', 'cleanup', 'notification'] as SelectionIntent[]) {
    const snapshot = navigation.snapshot(view);
    assert.equal(navigation.presented(snapshot, a), view === 'all' ? a : undefined, 'hidden remembered selection has no presentation');
    const plan = navigation.selection(a, snapshot, intent)!;
    const explicit = ['explicit', 'row', 'notification'].includes(intent);
    assert.equal(plan.view, view === 'all' || explicit ? 'all' : view);
    assert.equal(plan.focus, intent !== 'restore');
    assert.equal(plan.reveal, intent === 'explicit' || intent === 'notification');
    assert.equal('connect' in plan, false, 'navigation intents cannot opt out of selected-session connection');
    assert.deepEqual(navigation.open().map(s => s.lastUsed), [2, 1]);
  }
  assert.equal(navigation.selection(session('closed'), navigation.snapshot('all'), 'explicit'), undefined);
  assert.throws(() => navigation.add(session('a')), /already open/);
  const all = navigation.all() as Session[]; all.reverse();
  assert.deepEqual(ids(navigation.all()), ['a', 'b'], 'projection consumers cannot mutate canonical order');
});

test('cleanup prefers connected current-view recency, then All, then next/previous inactive rows', () => {
  const navigation = model(), removed = session('removed', 10), firstArrival = session('first', 1), newerArrival = session('newer', 2), hidden = session('hidden', 20);
  [removed, firstArrival, newerArrival, hidden].forEach(s => navigation.add(s));
  firstArrival.attention = true; navigation.snapshot('unread');
  removed.attention = true; newerArrival.attention = true;
  const before = navigation.snapshot('unread', removed, removed);
  navigation.remove(removed); firstArrival.connected = newerArrival.connected = hidden.connected = true;
  let result = navigation.replacement(before, navigation.snapshot('unread'));
  assert.deepEqual(result, { target: newerArrival, view: 'unread' }, 'current-view preference uses recency, not inbox position');
  firstArrival.connected = newerArrival.connected = false;
  result = navigation.replacement(before, navigation.snapshot('unread'));
  assert.deepEqual(result, { target: hidden, view: 'all' });
  hidden.connected = false;
  result = navigation.replacement(before, navigation.snapshot('unread'));
  assert.deepEqual(result, { target: newerArrival, view: 'unread' }, 'inactive fallback uses next displayed row');
  navigation.remove(newerArrival);
  assert.deepEqual(navigation.replacement(before, navigation.snapshot('unread')), { target: firstArrival, view: 'unread' }, 'then previous displayed row');
  navigation.remove(firstArrival);
  assert.deepEqual(navigation.replacement(before, navigation.snapshot('unread')), { target: hidden, view: 'all' }, 'exhausted filter falls back to All');
  navigation.remove(hidden);
  assert.deepEqual(navigation.replacement(before, navigation.snapshot('unread')), { target: undefined, view: 'all' });
});

test('batch cleanup preserves a surviving selection and removes the entire subtree before resolving once', () => {
  const navigation = model(), parent = session('parent', 3), child = session('child', 4), surviving = session('surviving', 2);
  [parent, child, surviving].forEach(s => navigation.add(s));
  child.connected = true; surviving.connected = true;
  const selected = navigation.snapshot('all', surviving, surviving);
  navigation.remove(parent); navigation.remove(child);
  assert.deepEqual(navigation.replacement(selected, navigation.snapshot('all')), { target: surviving, view: 'all' });
  assert.equal(navigation.selection(surviving, navigation.snapshot('all'), 'cleanup')!.target, surviving);
  assert.deepEqual(ids(navigation.all()), ['surviving']);
});
