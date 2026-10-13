import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { navigateDialogActions } from '../src/dialog-actions';

test('all four arrows wrap between actions in DOM order without activating either', () => {
  const dom = new JSDOM('<div><textarea></textarea><select><option>Choice</option></select><input readonly><button id="cancel">Cancel</button><button id="accept"><span>Accept</span></button></div>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const cancel = doc.querySelector<HTMLButtonElement>('#cancel')!;
  const accept = doc.querySelector<HTMLButtonElement>('#accept')!;
  let clicks = 0;
  cancel.onclick = accept.onclick = () => { clicks++; };
  const key = (key: string, target: Element = doc.activeElement!, extra: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    target.addEventListener('keydown', e => navigateDialogActions(e as KeyboardEvent, cancel, accept), { once: true });
    target.dispatchEvent(event);
    return event;
  };
  try {
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      accept.focus();
      assert.equal(key(arrow).defaultPrevented, true);
      assert.equal(doc.activeElement, cancel);
      key(arrow); assert.equal(doc.activeElement, accept);
    }
    accept.focus();
    key('ArrowLeft', accept.firstElementChild!); assert.equal(doc.activeElement, cancel);
    // Reversed editor-overlay action order is respected as well.
    cancel.before(accept);
    accept.focus(); key('ArrowRight'); assert.equal(doc.activeElement, cancel);
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      assert.equal(key('ArrowLeft', cancel, extra).defaultPrevented, false);
      assert.equal(doc.activeElement, cancel);
    }
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(key('ArrowRight', cancel, extra).defaultPrevented, true);
      assert.equal(doc.activeElement, cancel);
    }
    key('ArrowRight', cancel, { repeat: true }); assert.equal(doc.activeElement, accept);
    for (const control of doc.querySelectorAll('textarea, select, input')) {
      (control as HTMLElement).focus();
      for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        assert.equal(key(arrow, control).defaultPrevented, false);
        assert.equal(doc.activeElement, control);
      }
    }
    for (const state of ['disabled', 'hidden', 'inert']) {
      accept.setAttribute(state, '');
      cancel.focus(); key('ArrowRight'); assert.equal(doc.activeElement, cancel);
      accept.removeAttribute(state);
    }
    assert.equal(clicks, 0);
  } finally { dom.window.close(); }
});
