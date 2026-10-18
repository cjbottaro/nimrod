import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyModalAnimation, readModalAnimation } from '../src/modal-animation';

test('scan speeds have independent style defaults and never reinterpret a duration as px/s', () => {
  assert.deepEqual(readModalAnimation({}), { style: 'subtle', duration: 500 });
  assert.deepEqual(readModalAnimation({ 'appearance.modalAnimation': 'pixel' }), { style: 'pixel', duration: 500 });
  assert.equal(readModalAnimation({ 'appearance.modalAnimation': 'pixel', 'appearance.modalAnimationDuration': 1200 }).duration, 1200);
  assert.equal(readModalAnimation({ 'appearance.modalAnimation': 'crt', 'appearance.modalAnimationDuration': 1200 }).scanSpeed, 500);
  assert.equal(readModalAnimation({ 'appearance.modalAnimation': 'hologram', 'appearance.modalAnimationDuration': 1200 }).scanSpeed, 1000);
  for (const style of ['crt', 'hologram']) {
    assert.equal(readModalAnimation({ 'appearance.modalAnimation': style, 'appearance.modalScanSpeed': 750 }).scanSpeed, 750);
  }
  assert.equal(readModalAnimation({ 'appearance.modalScanSpeed': 101 }).scanSpeed, 100);
  assert.equal(readModalAnimation({ 'appearance.modalScanSpeed': 1425 }).scanSpeed, 1450);
  for (const value of [null, true, '500', 99, 1501, 500.5]) assert.throws(() => readModalAnimation({ 'appearance.modalScanSpeed': value }));
});

test('legacy duration normalization remains available for Subtle without changing files', () => {
  for (const [saved, expected] of [[0, 100], [50, 100], [105, 110], [251, 250], [2000, 1500]]) {
    assert.equal(readModalAnimation({ 'appearance.modalAnimationDuration': saved }).duration, expected);
  }
});

test('root presentation uses speed for scan styles and duration for Subtle, preserving focus', () => {
  const dom = new JSDOM('<input id="draft"><dialog open></dialog>');
  try {
    const document = dom.window.document, draft = document.getElementById('draft')!; draft.focus();
    applyModalAnimation(document.documentElement, readModalAnimation({}));
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '500ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '375ms');
    for (const [style, speed] of [['crt', '500'], ['hologram', '1000']]) {
      applyModalAnimation(document.documentElement, readModalAnimation({ 'appearance.modalAnimation': style }));
      assert.equal(document.documentElement.dataset.modalAnimation, style);
      assert.equal(document.documentElement.style.getPropertyValue('--modal-scan-speed'), speed);
    }
    applyModalAnimation(document.documentElement, { style: 'pixel', duration: 500 });
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '500ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '400ms');
    applyModalAnimation(document.documentElement, { style: 'none', duration: 1200 });
    assert.equal(document.documentElement.style.getPropertyValue('--modal-enter-duration'), '0ms');
    assert.equal(document.documentElement.style.getPropertyValue('--modal-exit-duration'), '0ms');
    assert.equal(document.activeElement, draft); assert.equal(document.querySelector('dialog')!.hasAttribute('open'), true);
  } finally { dom.window.close(); }
});
