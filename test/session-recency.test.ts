import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { SessionRecency, lastUsed, recentSessions, sortByRecency, nextLastUsed, captureSidebarScroll, revealSidebarRow } from '../src/session-recency';

test('recency sorts copies with stable legacy ties and validates stored timestamps', () => {
  const sessions = [{ lastUsed: 0 }, { lastUsed: 30 }, { lastUsed: 10 }, { lastUsed: 30 }, { lastUsed: 0 }];
  assert.deepEqual(recentSessions(sessions), [sessions[1], sessions[3], sessions[2], sessions[0], sessions[4]]);
  assert.equal(sessions[0].lastUsed, 0);
  for (const value of [undefined, null, '123', -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(lastUsed(value), 0);
  assert.equal(nextLastUsed(sessions, 30), 31);
  assert.equal(nextLastUsed(sessions, 2), 31, 'clock regression does not reverse use order');
  assert.equal(nextLastUsed(sessions, 100), 100);
});

test('tagged recency persists without a harness list and remains isolated from legacy file keys', () => {
  const recency = new SessionRecency(undefined), identity = { kind: 'fixture-harness', sessionId: 'same' };
  assert.equal(recency.record(identity, 123), true);
  assert.equal(recency.record({ path: '/same', sessionId: 'same' }, 456), true);
  const restored = new SessionRecency(recency.dump());
  assert.equal(restored.get(identity), 123);
  assert.equal(restored.get({ kind: 'another-harness', sessionId: 'same' }), 0);
  assert.equal(restored.get({ path: '/same', sessionId: 'same' }), 456);
  assert.equal(restored.delete(['fixture-harness:"same"']), true);
  assert.equal(restored.get(identity), 0);
});

test('list timestamp sorting shares sidebar recency rules and keeps unknown times last with stable ties', () => {
  const entries = [{ timestamp: undefined }, { timestamp: 30 }, { timestamp: NaN },
    { timestamp: 10 }, { timestamp: 30 }, { timestamp: Number.MAX_SAFE_INTEGER }];
  const original = [...entries];
  assert.deepEqual(sortByRecency(entries, entry => entry.timestamp), [entries[1], entries[4], entries[3], entries[0], entries[2], entries[5]]);
  assert.deepEqual(entries, original);
});

test('prefer-top reveals from list origin, not the current viewport, with zoom and hidden guards', () => {
  const dom = new JSDOM('<aside><div></div></aside>');
  try {
    const container = dom.window.document.querySelector('aside')!, row = container.firstElementChild as HTMLElement;
    let height = 100, rowTop = 40;
    Object.defineProperty(container, 'offsetHeight', { get: () => height });
    container.getBoundingClientRect = () => ({ top: 50, bottom: 250, height: 200 } as DOMRect);
    row.getBoundingClientRect = () => ({ top: 50 + (rowTop - container.scrollTop) * 2, bottom: 50 + (rowTop + 40 - container.scrollTop) * 2 } as DOMRect);
    container.scrollTop = 120;
    revealSidebarRow(container, row, 'prefer-top');
    assert.equal(container.scrollTop, 0, 'a fully visible row at list origin leaves the list at the top');
    rowTop = 200; container.scrollTop = 180;
    revealSidebarRow(container, row, 'prefer-top');
    assert.equal(container.scrollTop, 140, 'minimum reveal is computed from zero, even when the row was already visible');
    assert.equal(row.getBoundingClientRect().bottom, container.getBoundingClientRect().bottom, 'row is bottom-aligned, not centered');
    container.scrollTop = 180;
    revealSidebarRow(container, row);
    assert.equal(container.scrollTop, 180, 'ordinary navigation retains its nearest-edge behavior');
    row.hidden = true; container.scrollTop = 80;
    revealSidebarRow(container, row, 'prefer-top');
    assert.equal(container.scrollTop, 80, 'filtered rows do not reset scroll');
    row.hidden = false; height = 0;
    revealSidebarRow(container, row, 'prefer-top');
    assert.equal(container.scrollTop, 80, 'a collapsed sidebar does not reset scroll or schedule work');
  } finally { dom.window.close(); }
});

test('scroll anchoring excludes the moved row, accounts for zoom and reveals only on request', () => {
  const dom = new JSDOM('<aside><div>A</div><div>B</div><div>C</div><div>D</div></aside>');
  try {
    const container = dom.window.document.querySelector('aside')!;
    const rows = [...container.children] as HTMLElement[];
    let order = [...rows];
    Object.defineProperty(container, 'offsetHeight', { value: 80 });
    container.getBoundingClientRect = () => ({ top: 100, bottom: 260, height: 160 } as DOMRect);
    for (const row of rows) row.getBoundingClientRect = () => ({ top: 100 + (order.indexOf(row) * 40 - container.scrollTop) * 2, bottom: 100 + ((order.indexOf(row) + 1) * 40 - container.scrollTop) * 2 } as DOMRect);
    container.scrollTop = 40;
    const restore = captureSidebarScroll(container, rows, rows[1]);
    order = [rows[1], rows[0], rows[2], rows[3]];
    restore();
    assert.equal(container.scrollTop, 40, 'do not follow B to the top; C remains anchored');
    const restoreAgain = captureSidebarScroll(container, order, rows[3]);
    order = [rows[3], rows[1], rows[0], rows[2]];
    restoreAgain();
    assert.equal(container.scrollTop, 80, 'A remains at its previous pixel offset after insertion above');
    revealSidebarRow(container, rows[3]);
    assert.equal(container.scrollTop, 0, 'explicit navigation can reveal the row at the top');
    rows[3].hidden = true;
    const restoreHidden = captureSidebarScroll(container, order);
    restoreHidden(); assert.equal(container.scrollTop, 0);
  } finally { dom.window.close(); }
});
