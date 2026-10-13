import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Dialogs } from '../src/dialogs';
import { stubDialogs } from './dialog-fixture';

test('confirmation focus, labels and Enter agree; Cancel focus and Escape cancel; unsafe Enter is ignored', async () => {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const dialog = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
  const key = (key: string, extra: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    document.activeElement!.dispatchEvent(event); return event;
  };
  try {
    const dialogs = new Dialogs();
    const answer = dialogs.confirm('Close temporary session?', 'Discard temporary state.', undefined, 'Close temporary session');
    await Promise.resolve();
    const confirm = dialog.querySelector<HTMLButtonElement>('button[value="ok"]')!;
    assert.equal(document.activeElement, confirm);
    assert.equal(confirm.textContent, 'Close temporary session');
    assert.equal(confirm.getAttribute('aria-keyshortcuts'), 'Enter');
    assert.equal(confirm.childElementCount, 0);
    assert.equal(cancel.textContent, 'Cancel');
    assert.equal(cancel.childElementCount, 0);
    assert.equal(cancel.getAttribute('aria-keyshortcuts'), 'Escape');
    for (const extra of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
      assert.equal(key('Enter', extra).defaultPrevented, true);
      assert.equal(dialog.open, true);
    }
    assert.equal(key('Enter').defaultPrevented, true);
    assert.equal(await answer, true);
    const next = dialogs.confirm('Close temporary session?', 'Discard temporary state.');
    await Promise.resolve(); key('Escape');
    assert.equal(await next, false);
    const cancelled = dialogs.confirm('Close?', 'Discard?');
    await Promise.resolve(); key('ArrowLeft');
    assert.equal(document.activeElement, cancel); key('Enter');
    assert.equal(await cancelled, false);
    // Closing a confirmation removes its listener before the next queued input.
    const input = dialogs.input('Extension input', 'Keep multiline behavior');
    await Promise.resolve();
    assert.equal(dialog.querySelector('button[value="ok"]')!.getAttribute('aria-keyshortcuts'), null);
    assert.equal(cancel.getAttribute('aria-keyshortcuts'), null);
    assert.equal(dialog.querySelector('button[value="ok"]')!.textContent, 'Confirm');
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.querySelector('#host-dialog-input')!.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false); assert.equal(dialog.open, true);
    const field = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;
    field.focus(); assert.equal(key('ArrowLeft').defaultPrevented, false);
    assert.equal(document.activeElement, field);
    cancel.focus(); assert.equal(key('ArrowRight').defaultPrevented, true);
    assert.equal(document.activeElement, confirm);
    dialog.close('ok'); assert.equal(await input, 'Keep multiline behavior');
  } finally { globalThis.document = previous; dom.window.close(); }
});
