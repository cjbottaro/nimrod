import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installDeletionReview } from '../src/deletion-review';
import { stubDialogs } from './dialog-fixture';

function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const dialog = dom.window.document.querySelector<HTMLDialogElement>('#deletion-review')!;
  const controller = installDeletionReview(dialog);
  return { dom, dialog, controller, doc: dom.window.document, dispose() { controller.dispose(); dom.window.close(); } };
}
const sessions = [
  { file: '/store/root', title: 'Root' },
  { file: '/store/child', title: 'Child', parent: '/store/root' },
  { file: '/store/grandchild', title: '<script>unsafe</script>', parent: '/store/child' },
];

test('loading opens synchronously and updates the same modal without changing Cancel focus', async () => {
  const f = fixture();
  try {
    f.controller.loading();
    assert.equal(f.dialog.open, true);
    assert.equal(f.doc.activeElement?.id, 'deletion-cancel');
    assert.equal(f.doc.querySelector<HTMLButtonElement>('#deletion-confirm')!.disabled, true);
    assert.equal(f.doc.querySelector('#deletion-tree')!.getAttribute('aria-busy'), 'true');
    assert.match(f.doc.querySelector('#deletion-tree [role="status"]')!.textContent!, /Loading session tree/);
    f.dialog.close('delete'); // Even a synthetic form close cannot confirm loading.
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
    assert.equal(f.dialog.open, false);
    f.controller.cancel();
    f.controller.loading();
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
    f.controller.loading(); f.dialog.close('cancel');
    assert.equal(await f.controller.review({ id: 'late', sessions }), false);
    assert.equal(f.dialog.open, false);
    f.controller.cancel();
    const host = f.doc.querySelector<HTMLDialogElement>('#host-dialog')!; host.showModal();
    f.controller.loading(); assert.equal(f.dialog.open, false);
    f.controller.cancel(); host.close(); assert.equal(f.dialog.open, false);
    f.controller.loading(); assert.equal(f.dialog.open, true);
    f.controller.cancel(); assert.equal(f.dialog.open, false);
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
    assert.equal(f.doc.querySelector('#deletion-tree script'), null);
    assert.doesNotMatch(f.doc.querySelector('#deletion-tree')!.textContent!, /\/store\//);
    f.dialog.close('delete'); assert.equal(await answer, true);
  } finally { f.dispose(); }
});

test('duplicate names show disambiguating paths; cancellation/disposal does not confirm', async () => {
  const f = fixture();
  try {
    const answer = f.controller.review({ id: 'review', sessions: sessions.map(s => ({ ...s, title: 'Same name' })) });
    assert.equal(f.doc.querySelectorAll('#deletion-tree small').length, 3);
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

test('repeated and composing Enter cannot activate the destructive form', () => {
  const f = fixture();
  try {
    void f.controller.review({ id: 'review', sessions });
    for (const extra of [{ repeat: true }, { isComposing: true }]) {
      const event = new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
      f.doc.querySelector('#deletion-confirm')!.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    }
  } finally { f.dispose(); }
});
