import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyModalAnimation, readModalAnimation } from '../src/modal-animation';

test('style-specific defaults apply only when duration is omitted', () => {
  assert.deepEqual(readModalAnimation({}), { style: 'subtle', duration: 500 });
  assert.deepEqual(readModalAnimation({ 'appearance.modalAnimation': 'crt' }), { style: 'crt', duration: 300 });
  assert.deepEqual(readModalAnimation({ 'appearance.modalAnimation': 'hologram' }), { style: 'hologram', duration: 300 });
  for (const style of ['subtle', 'crt', 'hologram', 'none']) {
    for (const duration of [0, 160, 500, 1200]) {
      assert.deepEqual(readModalAnimation({ 'appearance.modalAnimation': style, 'appearance.modalAnimationDuration': duration }), { style, duration });
    }
  }
});

test('modal animation applies presentation tokens without touching focus or open dialogs', () => {
  const dom = new JSDOM('<input id="draft"><dialog open></dialog>');
  try {
    const document = dom.window.document, draft = document.getElementById('draft')!;
    draft.focus();
    applyModalAnimation(document.documentElement, readModalAnimation({}));
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '500ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '375ms');
    assert.equal(document.documentElement.dataset.modalAnimation, 'subtle');
    applyModalAnimation(document.documentElement, readModalAnimation({ 'appearance.modalAnimation': 'crt', 'appearance.modalAnimationDuration': 800 }));
    assert.equal(document.documentElement.dataset.modalAnimation, 'crt');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '800ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '640ms');
    applyModalAnimation(document.documentElement, readModalAnimation({ 'appearance.modalAnimation': 'hologram' }));
    assert.equal(document.documentElement.dataset.modalAnimation, 'hologram');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '300ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '240ms');
    applyModalAnimation(document.documentElement, { style: 'none', duration: 1200 });
    assert.equal(document.documentElement.dataset.modalAnimation, 'none');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '0ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '0ms');
    assert.equal(document.activeElement, draft);
    assert.equal(document.querySelector('dialog')!.hasAttribute('open'), true);
  } finally { dom.window.close(); }
});
