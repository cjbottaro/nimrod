import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { sessionTime, sessionIndicator, installSessionTimeRefresh, createSessionRowContent, updateSessionRowContent } from '../src/session-sidebar';
import { SessionRecency } from '../src/session-recency';

test('recency retains closed identities, ignores malformed entries and never reuses a replaced file identity', () => {
  const identity = { path: '/sessions/a', sessionId: 'a' };
  const recency = new SessionRecency({ '/sessions/a': { sessionId: 'a', lastUsed: 100 }, '/bad': null, '/invalid': { lastUsed: 200 }, '/date-overflow': { sessionId: 'a', lastUsed: Number.MAX_SAFE_INTEGER } });
  assert.equal(recency.get(identity), 100);
  assert.equal(recency.get({ ...identity, sessionId: 'replacement' }), 0);
  assert.equal(recency.record(identity, 50), false);
  assert.equal(recency.record(identity, 110), true);
  assert.equal(recency.record(identity, 110), false);
  assert.deepEqual(recency.dump(), { '/sessions/a': { sessionId: 'a', lastUsed: 110 } });
  assert.equal(new SessionRecency(JSON.parse(JSON.stringify(recency.dump()))).get(identity), 110);
  assert.equal(recency.record({ ...identity, sessionId: 'replacement' }, 20), true);
  assert.equal(recency.get(identity), 0);
  assert.equal(recency.delete(['/missing']), false);
  assert.equal(recency.delete(['/sessions/a']), true);
  assert.deepEqual(recency.dump(), {});
});

test('sidebar time uses minute precision, local dates, years when needed and handles unknown/future/invalid timestamps', () => {
  const now = new Date(2026, 6, 17, 12).getTime();
  assert.match(sessionTime(now, now, 'en-US'), /^Just now · Jul 17$/);
  assert.match(sessionTime(now - 59_999, now, 'en-US'), /^Just now · /);
  assert.match(sessionTime(now - 60_000, now, 'en-US'), /^1 minute ago · /);
  assert.match(sessionTime(now - 120_000, now, 'en-US'), /^2 minutes ago · /);
  assert.match(sessionTime(now - 7_200_000, now, 'en-US'), /^2 hours ago · Jul 17$/);
  assert.match(sessionTime(now - 2 * 86_400_000, now, 'en-US'), /^2 days ago · /);
  assert.match(sessionTime(now - 60 * 86_400_000, now, 'en-US'), /^2 months ago · /);
  assert.match(sessionTime(new Date(2024, 6, 17, 12).getTime(), now, 'en-US'), /^2 years ago · Jul 17, 2024$/);
  assert.match(sessionTime(now + 60_000, now, 'en-US'), /^Just now · /);
  for (const invalid of [0, undefined, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER]) assert.equal(sessionTime(invalid, now), 'No message time');
});

test('state indicators have distinct idle/unread/input/error shapes and explicit lifecycle precedence', () => {
  assert.deepEqual(sessionIndicator({ inactive: true }), { state: 'inactive', label: 'Inactive', mark: '○' });
  assert.deepEqual(sessionIndicator({}), { state: 'ready', label: 'Ready', mark: '•' });
  assert.deepEqual(sessionIndicator({ unread: true }), { state: 'unread', label: 'Unread', mark: '◉' });
  assert.equal(sessionIndicator({ busy: true, unread: true }).state, 'working');
  assert.equal(sessionIndicator({ compacting: true, busy: true }).state, 'compacting');
  assert.equal(sessionIndicator({ pending: true }).state, 'sending');
  assert.equal(sessionIndicator({ inputCount: 1, busy: true }).mark, '?');
  assert.equal(sessionIndicator({ failed: true, inactive: true }).mark, '!');
  assert.equal(sessionIndicator({ blocked: true, failed: true }).state, 'recovery');
  for (const state of ['starting', 'restarting', 'closing', 'deleting'] as const) assert.equal(sessionIndicator({ [state]: true, failed: true }).state, state);
});

test('shared row updates preserve content nodes and add/remove a separately accessible badge', () => {
  const dom = new JSDOM('');
  try {
    const row = dom.window.document.createElement('div');
    const content = createSessionRowContent(row, 'row-time');
    const presentation = { timestamp: 100, indicator: sessionIndicator({ busy: true }), badge: 'Open' };
    updateSessionRowContent(content, 'Long title', presentation);
    const badge = row.querySelector('.session-row-badge');
    assert.equal(content.rowLabel.textContent, 'Long title');
    assert.equal(badge?.textContent, 'Open');
    assert.equal(row.getAttribute('aria-label'), 'Long title — Working — Open');
    assert.equal(row.getAttribute('aria-describedby'), content.rowTime.id);
    updateSessionRowContent(content, 'Renamed', presentation);
    assert.equal(row.querySelector('.session-row-badge'), badge);
    assert.equal(row.querySelector('.session-indicator'), content.rowIndicator);
    assert.equal(row.querySelector('time'), content.rowTime);
    updateSessionRowContent(content, 'Renamed', { ...presentation, badge: undefined });
    assert.equal(row.querySelector('.session-row-badge'), null);
    assert.equal(row.getAttribute('aria-label'), 'Renamed — Working');
  } finally { dom.window.close(); }
});

test('relative-time refresh runs once per minute/foreground transition, pauses while hidden and disposes', () => {
  const dom = new JSDOM('', { pretendToBeVisual: true });
  try {
    const win = dom.window;
    let scheduled!: () => void, interval = 0, cancelled = 0, refreshed = 0;
    win.setInterval = ((callback: () => void, delay: number) => { scheduled = callback; interval = delay; return 17; }) as typeof win.setInterval;
    win.clearInterval = id => { cancelled = id!; };
    let visibility = 'visible'; Object.defineProperty(win.document, 'visibilityState', { get: () => visibility });
    const dispose = installSessionTimeRefresh(win as unknown as Window, () => refreshed++);
    assert.equal(interval, 60_000); assert.equal(refreshed, 0);
    scheduled(); assert.equal(refreshed, 1);
    visibility = 'hidden'; scheduled(); win.document.dispatchEvent(new win.Event('visibilitychange')); assert.equal(refreshed, 1);
    visibility = 'visible'; win.document.dispatchEvent(new win.Event('visibilitychange')); win.dispatchEvent(new win.Event('focus')); assert.equal(refreshed, 3);
    dispose(); assert.equal(cancelled, 17);
    win.document.dispatchEvent(new win.Event('visibilitychange')); win.dispatchEvent(new win.Event('focus')); assert.equal(refreshed, 3);
  } finally { dom.window.close(); }
});
