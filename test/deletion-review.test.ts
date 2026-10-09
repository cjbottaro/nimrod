import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installDeletionReview } from '../src/deletion-review';
import { stubDialogs } from './dialog-fixture';

function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  let now = 0, nextTimer = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  dom.window.setTimeout = (handler, delay = 0) => {
    if (typeof handler !== 'function') throw new Error('Expected a timer callback');
    const id = ++nextTimer; timers.set(id, { at: now + delay, run: () => handler() }); return id;
  };
  dom.window.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
  };
  const dialog = dom.window.document.querySelector<HTMLDialogElement>('#deletion-review')!;
  const controller = installDeletionReview(dialog);
  return { dom, dialog, controller, advance, timers, doc: dom.window.document, dispose() { controller.dispose(); dom.window.close(); } };
}
const sessions = [
  { file: '/store/root', title: 'Root' },
  { file: '/store/child', title: 'Child', parent: '/store/root' },
  { file: '/store/grandchild', title: '<script>unsafe</script>', parent: '/store/child' },
];

test('fast previews open the populated review directly and cancel the delayed loading timer', async () => {
  const f = fixture();
  try {
    f.controller.loading(); assert.equal(f.dialog.open, false);
    f.advance(149); assert.equal(f.dialog.open, false);
    const answer = f.controller.review({ id: 'fast', sessions });
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.querySelector('#deletion-tree [role="status"]'), null);
    assert.equal(f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.disabled, false);
    assert.equal(f.timers.size, 0);
    f.advance(1000); assert.equal(f.dialog.open, true);
    f.dialog.close('delete'); assert.equal(await answer, true);
    f.advance(1000); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('slow previews show loading after 150ms and update the same modal without changing Cancel focus', async () => {
  const f = fixture();
  try {
    f.controller.loading();
    assert.equal(f.dialog.open, false);
    f.advance(149); assert.equal(f.dialog.open, false);
    f.advance(1); assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    assert.equal(f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.disabled, true);
    assert.equal(f.doc.querySelector('#deletion-tree')!.getAttribute('aria-busy'), 'true');
    assert.match(f.doc.querySelector('#deletion-tree [role="status"]')!.textContent!, /Loading session tree/);
    f.dialog.close('delete'); // Even a synthetic form close cannot confirm loading.
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
    assert.equal(f.dialog.open, false);
    f.controller.cancel();
    f.controller.loading(); f.advance(150);
    assert.equal(f.dialog.open, true);
    const answer = f.controller.review({ id: 'next', sessions });
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    assert.equal(f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.disabled, false);
    assert.equal(f.doc.querySelector('#deletion-tree')!.getAttribute('aria-busy'), 'false');
    f.dialog.close('delete'); assert.equal(await answer, true);
  } finally { f.dispose(); }
});

test('loading cancellation prevents late review from reopening and cleanup closes a queued preview', async () => {
  const f = fixture();
  try {
    f.controller.loading(); f.advance(150); f.dialog.close('cancel');
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
    assert.equal(f.dialog.open, false);
    f.controller.cancel();
    const host = f.doc.querySelector<HTMLDialogElement>('#host-dialog')!; host.showModal();
    f.controller.loading(); assert.equal(f.dialog.open, false);
    host.close(); assert.equal(f.dialog.open, false); // Other-modal close cannot bypass the delay.
    f.advance(150); assert.equal(f.dialog.open, true);
    f.controller.cancel(); assert.equal(f.dialog.open, false);
    host.showModal(); f.controller.loading(); f.advance(150); assert.equal(f.dialog.open, false);
    f.controller.cancel(); host.close(); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('preview failure or disposal before the loading delay never opens a late modal', () => {
  const f = fixture();
  try {
    f.controller.loading(); f.controller.cancel(); f.advance(1000);
    assert.equal(f.dialog.open, false); assert.equal(f.timers.size, 0);
    f.controller.loading(); f.controller.dispose(); f.advance(1000);
    assert.equal(f.dialog.open, false); assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});

test('custom deletion review displays nested safe text, concise copy and defaults to Cancel', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'review', sessions });
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    assert.equal(f.doc.querySelector('#deletion-description')!.textContent, 'Deletes these sessions and their saved drafts and references.');
    assert.equal(f.doc.querySelector('#deletion-confirm')!.textContent, 'Delete 3 sessions');
    assert.equal(f.doc.querySelectorAll('#deletion-tree ul ul ul').length, 1);
    assert.equal(f.doc.querySelectorAll('#deletion-tree ul[role="list"]').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree li > .deletion-tree-row').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree .deletion-tree-root').length, 1);
    assert.equal(f.doc.querySelectorAll('#deletion-tree svg[aria-hidden="true"][focusable="false"]').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree svg title').length, 0);
    assert.equal(f.doc.querySelector('#deletion-tree script'), null);
    assert.doesNotMatch(f.doc.querySelector('#deletion-tree')!.textContent!, /\/store\//);
    f.dialog.close('delete'); assert.equal(await answer, true);
  } finally { f.dispose(); }
});

test('cross-project descendants disclose their project directories in the initiating review', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'projects', sessions: sessions.map((session, i) => ({ ...session, cwd: i ? '/other-project' : '/root-project' })) });
    assert.equal(f.doc.querySelectorAll('#deletion-tree .deletion-tree-text > small').length, 3);
    assert.match(f.doc.querySelector('#deletion-tree')!.textContent!, /Project: \/root-project/);
    assert.match(f.doc.querySelector('#deletion-tree')!.textContent!, /Project: \/other-project/);
    f.controller.cancel(); assert.equal(await answer, false);
  } finally { f.dispose(); }
});

test('duplicate names show disambiguating paths; cancellation/disposal does not confirm', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'review', sessions: sessions.map(s => ({ ...s, title: 'Same name' })) });
    assert.equal(f.doc.querySelectorAll('#deletion-tree .deletion-tree-text > small').length, 3);
    f.controller.cancel(); assert.equal(await answer, false);
    const next = f.controller.review({ id: 'next', sessions });
    f.controller.dispose(); assert.equal(await next, false);
  } finally { f.dispose(); }
});

test('review waits behind an existing modal and rejects disconnected/cyclic trees', async () => {
  const f = fixture();
  try {
    const host = f.doc.querySelector<HTMLDialogElement>('#host-dialog')!; host.showModal();
    const answer = f.controller.review({ id: 'review', sessions });
    assert.equal(f.dialog.open, false); host.close(); assert.equal(f.dialog.open, true);
    f.dialog.close('cancel'); assert.equal(await answer, false);
    assert.equal(await f.controller.review({ id: 'bad', sessions: [{ file: 'a', title: 'A', parent: 'b' }, { file: 'b', title: 'B', parent: 'a' }] }), false);
    assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('Enter confirms from Cancel focus and Escape cancels from Delete focus', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'enter', sessions });
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    const enter = new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f.doc.activeElement!.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true); assert.equal(await answer, true);
    const next = f.controller.review({ id: 'escape', sessions });
    f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.focus();
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await next, false);
    f.controller.loading(); f.advance(150);
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(f.dialog.open, true, 'Enter cannot confirm or cancel a loading preview');
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
  } finally { f.dispose(); }
});

test('repeated and composing Enter cannot activate the destructive form', () => {
  const f = fixture();
  try {
    void f.controller.review({ id: 'review', sessions });
    for (const extra of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
      const event = new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
      f.doc.querySelector('#deletion-confirm')!.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    }
  } finally { f.dispose(); }
});
