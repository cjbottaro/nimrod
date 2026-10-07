import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { lastUsed, recentSessions, nextLastUsed, captureSidebarScroll, revealSidebarRow } from '../src/session-recency';

test('recency sorts copies with stable legacy ties and validates stored timestamps', () => {
  const sessions = [{ lastUsed: 0 }, { lastUsed: 30 }, { lastUsed: 10 }, { lastUsed: 30 }, { lastUsed: 0 }];
  assert.deepEqual(recentSessions(sessions), [sessions[1], sessions[3], sessions[2], sessions[0], sessions[4]]);
  assert.equal(sessions[0].lastUsed, 0);
  for (const value of [undefined, null, '123', -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(lastUsed(value), 0);
  assert.equal(nextLastUsed(sessions, 30), 31);
  assert.equal(nextLastUsed(sessions, 2), 31, 'clock regression does not reverse use order');
  assert.equal(nextLastUsed(sessions, 100), 100);
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
