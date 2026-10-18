import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { pixelGrid } from '../src/modal-pixels';
import { installPixelSurface, pixelCapabilities } from '../src/modal-pixel-surface';

test('soft tiles filter live content and fade it with a bounded alpha mask, without form copies', () => {
  const dom = new JSDOM('<div id="shell"><input value="live"></div><div id="layer"></div>');
  try {
    Object.assign(dom.window, { CSS: { supports: () => true } });
    const document = dom.window.document, shell = document.getElementById('shell')!, layer = document.getElementById('layer')!;
    shell.style.setProperty('mask-image', 'linear-gradient(black, black)');
    const previous = shell.style.getPropertyValue('mask-image');
    const records: { element: Element; frames: Keyframe[] }[] = [];
    const grid = pixelGrid(620, 240, { size: 48, soft: true });
    const cleanup = installPixelSurface(layer, shell, grid, { blur: 6, fade: true }, 1, { left: 20, top: 40 },
      (element, frames) => { records.push({ element, frames }); });
    assert.equal(layer.querySelectorAll('rect').length, grid.tiles.length);
    assert.equal(layer.querySelectorAll('[data-modal-pixel-blur-tile]').length, grid.tiles.length);
    assert.equal(layer.querySelectorAll('input, textarea, form').length, 0);
    assert.equal(layer.querySelectorAll('feGaussianBlur').length, 0); // Content blur, not feathered mask edges.
    assert.ok(shell.style.getPropertyValue('mask-image').includes('nimrod-pixel-mask-'));
    const fade = records.find(record => record.element.localName === 'rect')!;
    assert.equal(fade.frames[0].opacity, 0); assert.equal(fade.frames.at(-1)!.opacity, 1);
    const blur = records.find(record => record.element.hasAttribute('data-modal-pixel-blur-tile'))!;
    assert.equal(blur.frames[0].backdropFilter, 'blur(6px)'); assert.equal(blur.frames.at(-1)!.backdropFilter, 'blur(0px)');
    assert.ok(blur.frames.every(frame => String(frame.clipPath).startsWith('inset(')));
    shell.querySelector('input')!.value = 'edited while materializing';
    cleanup();
    assert.equal(layer.childElementCount, 0); assert.equal(shell.style.getPropertyValue('mask-image'), previous);
    assert.equal(shell.querySelector('input')!.value, 'edited while materializing');
  } finally { dom.window.close(); }
});

test('sharp mode adds no soft surface, and renderer capability checks retain a prefixed fallback', () => {
  assert.deepEqual(pixelCapabilities(undefined), { blur: undefined, fade: false });
  assert.deepEqual(pixelCapabilities({ supports: property => property.startsWith('-webkit-') }), { blur: 'webkitBackdropFilter', fade: true });
  const dom = new JSDOM('<div id="shell"></div><div id="layer"></div>');
  try {
    Object.assign(dom.window, { CSS: { supports: () => true } });
    const shell = dom.window.document.getElementById('shell')!, layer = dom.window.document.getElementById('layer')!;
    const cleanup = installPixelSurface(layer, shell, pixelGrid(620, 240), { blur: 0, fade: false }, 1, { left: 0, top: 0 }, () => assert.fail('sharp mode has no soft effects'));
    assert.equal(layer.childElementCount, 0); assert.equal(shell.style.getPropertyValue('mask-image'), ''); cleanup();
  } finally { dom.window.close(); }
});
