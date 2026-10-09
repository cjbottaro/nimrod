import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installSidebarResize, savedSidebarWidth, sidebarWidthKey } from '../src/sidebar-resize';

function fixture(initial?: unknown) {
  const dom = new JSDOM('<button id="toggle"></button><div id="layout"><aside></aside><div id="handle" tabindex="0"></div></div><textarea></textarea><dialog></dialog>', { pretendToBeVisual: true });
  const win = dom.window, layout = win.document.getElementById('layout')!, sidebar = win.document.querySelector('aside')!;
  const handle = win.document.getElementById('handle')!, toggle = win.document.getElementById('toggle')!, prompt = win.document.querySelector('textarea')!;
  let available = 1000, scale = 1.25, stored = initial;
  const saved: (number | null)[] = [];
  Object.defineProperty(layout, 'clientWidth', { get: () => available });
  Object.defineProperty(layout, 'offsetWidth', { get: () => available });
  layout.getBoundingClientRect = () => ({ width: available * scale } as DOMRect);
  win.matchMedia = ((query: string) => ({ matches: win.innerWidth <= (query.includes('600') ? 600 : 760) })) as typeof win.matchMedia;
  const resize = installSidebarResize(win as unknown as Window, { layout, sidebar, handle, toggle }, {
    read: () => stored, save: width => { stored = width; saved.push(width); },
  });
  const pointer = (type: string, x: number, id = 1, button = 0) => {
    const event = new win.MouseEvent(type, { clientX: x, button, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
    (type === 'pointerdown' || type === 'lostpointercapture' ? handle : win).dispatchEvent(event);
  };
  const key = (key: string, extra: KeyboardEventInit = {}) => handle.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  return { dom, win, layout, sidebar, handle, toggle, prompt, resize, saved, pointer, key,
    width: () => Number(handle.getAttribute('aria-valuenow')),
    restore(value: unknown) { stored = value; resize.reload(); },
    viewport(width: number, viewportWidth = width) { available = width; Object.defineProperty(win, 'innerWidth', { configurable: true, value: viewportWidth }); win.dispatchEvent(new win.Event('resize')); },
    scale(value: number) { scale = value; },
    close() { resize.dispose(); win.close(); },
  };
}

test('sidebar width validates app state and restores without saving', () => {
  for (const value of [undefined, null, '350', {}, 0, -20, NaN, Infinity]) assert.equal(savedSidebarWidth(value), undefined);
  assert.equal(savedSidebarWidth(100), 180); assert.equal(savedSidebarWidth(900), 520); assert.equal(savedSidebarWidth(333.4), 333);
  assert.equal(sidebarWidthKey('/project'), 'nimrod.sidebar.width:/project');
  const f = fixture(350);
  try { assert.equal(f.width(), 350); assert.deepEqual(f.saved, []); f.restore(420); assert.equal(f.width(), 420); assert.deepEqual(f.saved, []); }
  finally { f.close(); }
});

test('pointer drag accounts for zoom, saves once on release, and retains composer focus/draft', () => {
  const f = fixture(300);
  try {
    f.prompt.value = 'Unsent draft'; f.prompt.focus();
    f.pointer('pointerdown', 375); f.pointer('pointermove', 500);
    assert.equal(f.width(), 400); assert.deepEqual(f.saved, []);
    assert.equal(f.dom.window.document.activeElement, f.prompt);
    f.pointer('pointermove', 550, 2); assert.equal(f.width(), 400, 'another pointer cannot take over');
    f.pointer('pointerup', 500);
    assert.deepEqual(f.saved, [400]); assert.equal(f.prompt.value, 'Unsent draft');
    assert.equal(f.win.document.body.classList.contains('resizing-sidebar'), false);
    f.pointer('lostpointercapture', 500); assert.deepEqual(f.saved, [400]);
  } finally { f.close(); }
});

test('Escape, pointer cancellation/capture loss, blur and viewport change roll back without saving', () => {
  for (const end of ['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'resize']) {
    const f = fixture(300);
    try {
      f.pointer('pointerdown', 375); f.pointer('pointermove', 500); assert.equal(f.width(), 400);
      if (end === 'Escape') f.key('Escape');
      else if (end === 'blur' || end === 'resize') f.win.dispatchEvent(new f.win.Event(end));
      else f.pointer(end, 500);
      assert.equal(f.width(), 300, end); assert.deepEqual(f.saved, []);
      assert.equal(f.win.document.body.classList.contains('resizing-sidebar'), false);
    } finally { f.close(); }
  }
});

test('separator supports keyboard bounds, large steps and double-click default reset', () => {
  const f = fixture(300);
  try {
    f.handle.focus(); f.key('ArrowRight'); f.key('ArrowLeft', { shiftKey: true });
    assert.deepEqual(f.saved, [310, 260]); assert.equal(f.win.document.activeElement, f.handle);
    f.key('Home'); assert.equal(f.width(), 180);
    f.key('ArrowLeft'); assert.equal(f.saved.length, 3, 'a clamped no-op does not write');
    f.key('End'); assert.equal(f.width(), 520);
    f.handle.dispatchEvent(new f.win.MouseEvent('dblclick', { button: 0, bubbles: true, cancelable: true }));
    assert.equal(f.width(), 260); assert.equal(f.saved.at(-1), null);
    assert.equal(f.handle.getAttribute('aria-valuetext'), '260 pixels');
  } finally { f.close(); }
});

test('viewport clamping does not overwrite preferred width and responsive defaults remain adaptive', () => {
  const f = fixture(480);
  try {
    f.viewport(600, 800); assert.equal(f.width(), 360);
    f.viewport(1000); assert.equal(f.width(), 480); assert.deepEqual(f.saved, []);
    f.viewport(400, 500); assert.equal(f.width(), 352, 'overlay leaves 48 layout pixels uncovered');
    f.viewport(200, 500); assert.equal(f.width(), 152); assert.equal(f.handle.getAttribute('aria-valuemin'), '152');
    f.restore(null); f.viewport(700); assert.equal(f.width(), 210);
    f.viewport(500); assert.equal(f.width(), 250);
    f.viewport(1000); assert.equal(f.width(), 260); assert.deepEqual(f.saved, []);
  } finally { f.close(); }
});

test('hidden/sidebar modal guards cancel drags and do not retain a focused hidden separator', () => {
  const f = fixture(300);
  try {
    f.pointer('pointerdown', 375); f.pointer('pointermove', 500);
    f.sidebar.hidden = true; f.handle.focus(); f.resize.refresh();
    assert.equal(f.width(), 300); assert.equal(f.handle.hidden, true); assert.equal(f.win.document.activeElement, f.toggle);
    f.key('ArrowRight'); f.pointer('pointerdown', 0); f.pointer('pointermove', 500); assert.deepEqual(f.saved, []);
    f.sidebar.hidden = false; f.resize.refresh();
    f.pointer('pointerdown', 375); f.pointer('pointermove', 500);
    f.win.document.querySelector('dialog')!.setAttribute('open', '');
    f.pointer('pointerup', 500); assert.equal(f.width(), 300);
    f.key('ArrowRight'); f.pointer('pointerdown', 375); assert.deepEqual(f.saved, []);
  } finally { f.close(); }
});

test('right-click and modified/IME keys are ignored; disposal cancels and detaches listeners', () => {
  const f = fixture(300);
  try {
    f.pointer('pointerdown', 375, 1, 2); f.pointer('pointermove', 500); assert.equal(f.width(), 300);
    f.key('ArrowRight', { ctrlKey: true }); f.key('ArrowLeft', { isComposing: true }); assert.deepEqual(f.saved, []);
    f.pointer('pointerdown', 375); f.pointer('pointermove', 500); f.resize.dispose();
    assert.equal(f.width(), 300); f.key('ArrowRight'); f.pointer('pointerup', 500); assert.deepEqual(f.saved, []);
  } finally { f.close(); }
});
