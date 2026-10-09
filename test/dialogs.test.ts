import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Dialogs } from '../src/dialogs';
import { stubDialogs } from './dialog-fixture';

test('confirmation Enter confirms from Cancel focus; Escape cancels; unsafe Enter is ignored', async () => {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const dialog = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
  const key = (key: string, extra: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    cancel.dispatchEvent(event); return event;
  };
  try {
    const dialogs = new Dialogs();
    const answer = dialogs.confirm('Close temporary session?', 'Discard temporary state.');
    await Promise.resolve(); cancel.focus();
    for (const extra of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
      assert.equal(key('Enter', extra).defaultPrevented, true);
      assert.equal(dialog.open, true);
    }
    assert.equal(key('Enter').defaultPrevented, true);
    assert.equal(await answer, true);
    const next = dialogs.confirm('Close temporary session?', 'Discard temporary state.');
    await Promise.resolve(); cancel.focus(); key('Escape');
    assert.equal(await next, false);
    // Closing a confirmation removes its listener before the next queued input.
    const input = dialogs.input('Extension input', 'Keep multiline behavior');
    await Promise.resolve();
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.querySelector('#host-dialog-input')!.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false); assert.equal(dialog.open, true);
    dialog.close('ok'); assert.equal(await input, 'Keep multiline behavior');
  } finally { globalThis.document = previous; dom.window.close(); }
});
