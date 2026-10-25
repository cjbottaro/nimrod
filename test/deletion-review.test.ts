import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installDeletionReview } from '../src/deletion-review';
import { stubDialogs } from './dialog-fixture';

function fixture(canCover?: (other: HTMLDialogElement) => boolean) {
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
  const controller = installDeletionReview(dialog, { canCover });
  return { dom, dialog, controller, advance, timers, doc: dom.window.document, dispose() { controller.dispose(); dom.window.close(); } };
}
const sessions = [
  { key: '/store/root', title: 'Root' },
  { key: '/store/child', title: 'Child', parentKey: '/store/root' },
  { key: '/store/grandchild', title: '<script>unsafe</script>', parentKey: '/store/child' },
];

test('single-session review uses integration wording and restores Pi tree wording on the next review', async () => {
  const f = fixture();
  try {
    const copilot = f.controller.review({ id: 'saved', sessions: [{ key: 'saved', title: 'Copilot title' }],
      title: 'Delete Copilot session', description: 'Delete only this saved session.' });
    assert.equal(f.doc.querySelector('#deletion-title')!.textContent, 'Delete Copilot session');
    assert.equal(f.doc.querySelector('#deletion-description')!.textContent, 'Delete only this saved session.');
    f.doc.querySelector<HTMLButtonElement>('#deletion-cancel')!.click();
    assert.equal(await copilot, false);
    const pi = f.controller.review({ id: 'pi', sessions });
    assert.equal(f.doc.querySelector('#deletion-title')!.textContent, 'Delete session tree');
    assert.match(f.doc.querySelector('#deletion-description')!.textContent!, /descendants/);
    f.doc.querySelector<HTMLButtonElement>('#deletion-cancel')!.click();
    assert.equal(await pi, false);
  } finally { f.dispose(); }
});

test('review can cover only the authorized deletion picker, with loading and higher-dialog priority retained', async () => {
  const f = fixture(other => other.id === 'command-palette');
  try {
    const picker = f.doc.querySelector<HTMLDialogElement>('#command-palette')!;
    const host = f.doc.querySelector<HTMLDialogElement>('#host-dialog')!;
    picker.showModal(); f.doc.querySelector<HTMLInputElement>('#palette-input')!.focus();
    f.controller.loading(); f.advance(150);
    assert.equal(picker.open, true); assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    const answer = f.controller.review({ id: 'nested', sessions });
    assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
    f.dialog.close('cancel'); assert.equal(await answer, false);
    assert.equal(picker.open, true); assert.equal(f.doc.activeElement?.id, 'palette-input');
    host.showModal();
    const blocked = f.controller.review({ id: 'blocked', sessions });
    assert.equal(f.dialog.open, false);
    host.close(); assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
    f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.click(); assert.equal(await blocked, true);
    assert.equal(f.dialog.open, true); assert.equal(picker.open, true); f.controller.cancel();
  } finally { f.dispose(); }
});

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
    f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.click(); assert.equal(await answer, true);
    f.advance(1000); assert.equal(f.dialog.open, true);
    f.controller.cancel(); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('slow previews show loading after 150ms and default untouched ready reviews to Delete', async () => {
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
    assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
    assert.equal(f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.disabled, false);
    assert.equal(f.doc.querySelector('#deletion-tree')!.getAttribute('aria-busy'), 'false');
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(await answer, true);
    assert.equal(f.doc.querySelector('.deletion-execution span:last-child')!.textContent, 'Stopping sessions…');
    assert.equal(f.dialog.open, true);
  } finally { f.dispose(); }
});

test('loading interactions preserve Cancel focus when review becomes ready', async () => {
  for (const interaction of ['keyboard', 'pointer']) {
    const f = fixture();
    try {
      f.controller.loading(); f.advance(150);
      assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
      const cancel = f.doc.querySelector<HTMLButtonElement>('#deletion-cancel')!;
      if (interaction === 'keyboard') {
        cancel.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      } else {
        cancel.dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true }));
      }
      const answer = f.controller.review({ id: interaction, sessions });
      assert.equal(f.doc.activeElement, cancel);
      cancel.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      assert.equal(await answer, false);
      assert.equal(f.dialog.open, false);
      assert.equal(f.doc.querySelector('.deletion-execution'), null);
      // A later operation must not inherit the earlier interaction flag.
      f.controller.cancel(); f.controller.loading(); f.advance(150);
      const next = f.controller.review({ id: 'next', sessions });
      assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
      f.controller.cancel(); assert.equal(await next, false);
    } finally { f.dispose(); }
  }
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

test('custom deletion review displays nested safe text, concise copy and defaults to Delete', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'review', sessions });
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
    assert.match(f.doc.querySelector('#deletion-description')!.textContent!, /Stops work.*including descendants/);
    assert.equal(f.doc.querySelector('#deletion-confirm')!.textContent, 'Delete 3 sessions');
    assert.equal(f.doc.querySelectorAll('#deletion-tree ul ul ul').length, 1);
    assert.equal(f.doc.querySelectorAll('#deletion-tree ul[role="list"]').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree li > .deletion-tree-row').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree .deletion-tree-root').length, 1);
    assert.equal(f.doc.querySelectorAll('#deletion-tree svg[aria-hidden="true"][focusable="false"]').length, 3);
    assert.equal(f.doc.querySelectorAll('#deletion-tree svg title').length, 0);
    assert.equal(f.doc.querySelector('#deletion-tree script'), null);
    assert.doesNotMatch(f.doc.querySelector('#deletion-tree')!.textContent!, /\/store\//);
    f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.click(); assert.equal(await answer, true);
    assert.equal(f.dialog.open, true);
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
    assert.equal(await f.controller.review({ id: 'bad', sessions: [{ key: 'a', title: 'A', parentKey: 'b' }, { key: 'b', title: 'B', parentKey: 'a' }] }), false);
    assert.equal(await f.controller.review({ id: 'duplicate-key', sessions: [{ key: 'same', title: 'A' }, { key: 'same', title: 'B' }] }), false);
    assert.equal(await f.controller.review({ id: 'empty-key', sessions: [{ key: '', title: 'A' }] }), false);
    assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('Enter confirms from Delete focus; Cancel focus and Escape cancel', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'enter', sessions });
    assert.equal(f.doc.activeElement?.id, 'deletion-confirm');
    const enter = new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f.doc.activeElement!.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true); assert.equal(await answer, true);
    assert.equal(f.dialog.open, true); f.controller.cancel();
    const next = f.controller.review({ id: 'escape', sessions });
    f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.focus();
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await next, false);
    const cancelled = f.controller.review({ id: 'cancel-enter', sessions });
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(await cancelled, false);
    f.controller.loading(); f.advance(150);
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel', 'Disabled Delete is skipped');
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(f.dialog.open, false, 'Enter on focused Cancel cancels a loading preview');
    f.doc.activeElement!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
  } finally { f.dispose(); }
});

test('confirmation keeps the modal open, blocks cancel/repeated submit and reports progress until reconciliation closes it', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'execute', sessions });
    const confirm = f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!;
    const cancel = f.doc.querySelector<HTMLButtonElement>('#deletion-cancel')!;
    const reviewedDescription = f.doc.querySelector('#deletion-description')!.textContent;
    const reviewedLabel = confirm.textContent;
    confirm.click();
    // Check synchronously: no confirmation continuation or native progress yet.
    assert.equal(confirm.disabled, true); assert.equal(cancel.disabled, true);
    assert.equal(f.doc.querySelector('.deletion-execution span:last-child')!.textContent, 'Stopping sessions…');
    assert.ok(f.doc.querySelector('.deletion-execution .deletion-spinner'));
    assert.equal(f.doc.querySelector('.deletion-tree-reserved')!.getAttribute('aria-hidden'), 'true');
    assert.equal(f.doc.querySelector('#deletion-tree')!.getAttribute('data-executing'), 'true');
    assert.equal(await answer, true);
    const reserved = f.doc.querySelector('.deletion-description-reserved')!;
    assert.equal(reserved.textContent, reviewedDescription);
    assert.equal(reserved.getAttribute('aria-hidden'), 'true');
    assert.equal(confirm.textContent, reviewedLabel);
    assert.equal(confirm.hasAttribute('aria-keyshortcuts'), false);
    assert.equal(f.dialog.open, true); assert.equal(confirm.disabled, true); assert.equal(cancel.disabled, true);
    assert.match(f.doc.querySelector('#deletion-description')!.textContent!, /Stopping sessions/);
    assert.equal(f.doc.activeElement?.id, 'deletion-tree');
    const escape = new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    f.doc.activeElement!.dispatchEvent(escape); assert.equal(escape.defaultPrevented, true);
    const nativeCancel = new f.dom.window.Event('cancel', { cancelable: true });
    f.dialog.dispatchEvent(nativeCancel); assert.equal(nativeCancel.defaultPrevented, true);
    confirm.form!.dispatchEvent(new f.dom.window.SubmitEvent('submit', { submitter: confirm, cancelable: true }));
    cancel.click(); assert.equal(f.dialog.open, true);
    assert.equal(await f.controller.review({ id: 'duplicate', sessions }), false);
    f.controller.progress('deleting'); assert.equal(f.doc.querySelector('.deletion-progress')!.textContent, 'Deleting sessions…');
    assert.equal(f.doc.querySelector('.deletion-execution span:last-child')!.textContent, 'Deleting sessions…');
    assert.equal(f.doc.querySelector('.deletion-description-reserved'), reserved);
    assert.equal(confirm.textContent, reviewedLabel);
    f.controller.cancel(); assert.equal(f.dialog.open, false);
    const next = f.controller.review({ id: 'next', sessions });
    assert.equal(confirm.disabled, false); assert.equal(cancel.disabled, false);
    assert.match(f.doc.querySelector('#deletion-description')!.textContent!, /Stops work/);
    assert.equal(f.doc.querySelector('.deletion-description-reserved'), null);
    assert.equal(f.doc.querySelector('.deletion-progress'), null);
    assert.equal(f.doc.querySelector('.deletion-execution'), null);
    assert.equal(f.doc.querySelector('#deletion-tree')!.hasAttribute('data-executing'), false);
    cancel.click(); assert.equal(await next, false);
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
