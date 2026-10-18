import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyModalAnimation } from '../src/modal-animation';
import { closeModal, installModalMotion, showModal, showModalOverlay, closeModalOverlay } from '../src/modal-motion';
import { stubDialogs } from './dialog-fixture';

function fixture(style: 'crt' | 'subtle' | 'hologram' | 'pixel' = 'crt') {
  const dom = new JSDOM('<style>#sample { background:rgb(30,40,50); } .nimrod-modal { clip-path:none; }</style><button id="opener">Open</button><dialog id="sample" class="nimrod-modal"><form method="dialog"><textarea id="field"></textarea><button>Close</button></form></dialog>', { pretendToBeVisual: true });
  const { document } = dom.window; stubDialogs(dom.window);
  const getStyle = dom.window.getComputedStyle.bind(dom.window); dom.window.getComputedStyle = element => getStyle(element);
  const timeline = { currentTime: null as number | null }; Object.defineProperty(document, 'timeline', { value: timeline });
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
  dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  const tick = (time: number) => { timeline.currentTime = time; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); };
  const observers = new Set<() => void>();
  Object.assign(dom.window, { CSS: { supports: () => true }, ResizeObserver: class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this.callback); } disconnect() { observers.delete(this.callback); }
  } });
  const records: { node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; paused: boolean; startTime: number | null; currentTime: number | null; finish(): void }[] = [];
  dom.window.HTMLElement.prototype.animate = function (frames, options) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const record = { node: this as HTMLElement, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, cancelled: false, paused: false, startTime: null as number | null, currentTime: null as number | null, finish: () => resolve() };
    records.push(record);
    return { finished, cancel: () => { record.cancelled = true; reject(new Error('cancelled')); }, pause: () => { record.paused = true; }, play: () => { record.paused = false; },
      get currentTime() { return record.currentTime; }, set currentTime(value: number | null) { record.currentTime = value; },
      get startTime() { return record.startTime; }, set startTime(value: number | null) { record.startTime = value; },
    } as unknown as Animation;
  };
  applyModalAnimation(document.documentElement, { style, duration: 500 });
  const owner = installModalMotion(document), dialog = document.querySelector('dialog')!;
  let height = 240;
  dialog.getBoundingClientRect = () => new dom.window.DOMRect(20, 40, 620, height);
  return { dom, document, records, owner, dialog, opener: document.getElementById('opener')!, tick,
    resize(next: number) { height = next; [...observers].forEach(callback => callback()); },
    dispose() { owner.dispose(); dom.window.close(); },
  };
}

for (const style of ['crt', 'hologram'] as const) {
  test(`${style} uses measured travel, synchronized edges and immediate inert native exit`, async () => {
    const f = fixture(style);
    try {
      f.opener.focus(); showModal(f.dialog); await Promise.resolve(); f.tick(10000);
      const entering = f.records.filter(record => !record.cancelled);
      assert.ok(entering.every(record => record.options.duration === 240 && record.startTime === 10000));
      assert.equal(entering.filter(record => record.node.hasAttribute('data-modal-scan-edge')).length, style === 'crt' ? 2 : 1);
      const field = f.document.querySelector<HTMLTextAreaElement>('#field')!; field.value = 'Current edited text'; field.focus();
      closeModal(f.dialog, 'cancel');
      assert.equal(f.dialog.open, false); assert.equal(f.dialog.returnValue, 'cancel'); assert.equal(f.document.activeElement, f.opener);
      const layer = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      assert.equal(layer.inert, true); assert.equal(layer.getAttribute('aria-hidden'), 'true'); assert.equal(layer.style.pointerEvents, 'none');
      const shadow = [...layer.children].find(node => node.shadowRoot)!.shadowRoot!;
      assert.equal(shadow.querySelector<HTMLTextAreaElement>('[data-modal-snapshot-id=field]')!.value, field.value);
      assert.equal(shadow.querySelectorAll('[id]').length, 0); assert.equal(f.document.querySelectorAll('#sample').length, 1);
      const exits = f.records.filter(record => layer.contains(record.node));
      const panel = exits.find(record => record.node.shadowRoot)!;
      assert.equal(panel.options.duration, 192); assert.ok(panel.frames.every(frame => !('opacity' in frame)));
      assert.equal(exits.some(record => record.node === layer), false);
      assert.ok(exits.every(record => record.paused && record.currentTime === 0));
      f.tick(20000); assert.ok(exits.every(record => record.startTime === 20000));
      showModal(f.dialog); assert.equal(layer.isConnected, false); assert.equal(field.value, 'Current edited text');
    } finally { f.dispose(); }
  });
}

test('retarget preserves Hologram pixel position/speed and old cancellation cannot remove the successor', async () => {
  const f = fixture('hologram');
  try {
    showModal(f.dialog); await Promise.resolve(); f.tick(1000);
    f.records.find(record => record.node === f.dialog && !record.cancelled)!.currentTime = 100;
    f.resize(400); await Promise.resolve(); await Promise.resolve();
    const layer = f.document.querySelector<HTMLElement>('[data-modal-motion=enter]')!;
    assert.equal(layer.isConnected, true);
    const current = f.records.filter(record => !record.cancelled);
    const panel = current.find(record => record.node === f.dialog)!;
    assert.equal(panel.options.duration, 300); // 400px high, 100px already scanned.
    const beam = current.find(record => record.node.hasAttribute('data-modal-hologram-line'))!;
    assert.equal(beam.frames[0].transform, 'translateY(100px) translateY(-50%)');
    panel.currentTime = 50; f.resize(500); await Promise.resolve();
    const successor = f.records.find(record => !record.cancelled && record.node.hasAttribute('data-modal-hologram-line'))!;
    assert.equal(successor.frames[0].transform, 'translateY(150px) translateY(-50%)');
    f.resize(80); await Promise.resolve();
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    assert.equal(f.dialog.open, true);
  } finally { f.dispose(); }
});

test('Pixel partial close preserves the current mask/progress and resize completes its opening', async () => {
  const f = fixture('pixel');
  try {
    f.opener.focus(); showModal(f.dialog); await Promise.resolve(); f.tick(1000);
    const entrance = f.records.find(record => record.node === f.dialog && !record.cancelled)!;
    assert.equal(entrance.options.duration, 500); assert.equal(entrance.frames.length, 13);
    entrance.currentTime = 250;
    closeModal(f.dialog);
    assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.opener);
    const layer = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
    const panel = f.records.find(record => layer.contains(record.node) && record.node.shadowRoot)!;
    assert.equal(panel.options.duration, 200); assert.equal(panel.options.direction, 'reverse');
    assert.ok(panel.frames.every(frame => !('opacity' in frame)));
    assert.ok(Number(layer.dataset.modalPixelTiles) <= 96);
    showModal(f.dialog); await Promise.resolve(); f.tick(2000);
    f.resize(100); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.dialog.open, true); assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    // No source effect remains to confuse a later complete close.
    closeModal(f.dialog);
    const complete = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
    const completePanel = f.records.find(record => complete.contains(record.node) && record.node.shadowRoot)!;
    assert.equal(completePanel.options.duration, 400);
    applyModalAnimation(f.document.documentElement, { style: 'none', duration: 500 });
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});

test('unsupported pixel clipping falls back to an immediately usable plain dialog', async () => {
  const f = fixture('pixel');
  try {
    Object.assign(f.dom.window, { CSS: { supports: () => false } });
    showModal(f.dialog); await Promise.resolve();
    assert.equal(f.dialog.open, true); assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    closeModal(f.dialog, 'cancel');
    assert.equal(f.dialog.open, false); assert.equal(f.dialog.returnValue, 'cancel');
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});

test('native default capture survives early microtasks and respects prevented/controlled closure', async () => {
  const f = fixture('subtle');
  try {
    showModal(f.dialog); await Promise.resolve();
    const form = f.dialog.querySelector('form')!;
    form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve(); assert.equal(f.dialog.open, true);
    f.dialog.close('ok'); assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    showModal(f.dialog);
    f.dialog.addEventListener('cancel', event => event.preventDefault(), { once: true });
    f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true })); await Promise.resolve();
    assert.equal(f.dialog.open, true); assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 0);
    f.dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(f.dialog); }, { once: true });
    f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true })); await Promise.resolve();
    assert.equal(f.dialog.open, false); assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    showModal(f.dialog); f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true }));
    await Promise.resolve(); f.dialog.close(); assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
  } finally { f.dispose(); }
});

test('every ordinary modal backdrop consumes the shared effective depth blur', () => {
  const css = readFileSync('src/modal.css', 'utf8');
  assert.match(css, /:root\[data-translucency=window\] dialog\.nimrod-modal::backdrop/);
  assert.match(css, /:root\[data-translucency=window\] \.modal-overlay::before/);
  assert.match(css, /backdrop-filter:blur\(var\(--nimrod-depth-blur-radius, 0px\)\)/);
  assert.doesNotMatch(css, /data-modal-depth-blur/);
});

test('overlay, hidden/disposed windows, None and completion never settle or reopen real dialogs', async () => {
  const f = fixture();
  try {
    const overlay = f.document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="nimrod-modal"><textarea>Editor draft</textarea></div>'; f.document.body.append(overlay);
    overlay.firstElementChild!.getBoundingClientRect = () => new f.dom.window.DOMRect(20, 40, 620, 240);
    showModalOverlay(overlay); await Promise.resolve(); closeModalOverlay(overlay);
    assert.equal(overlay.classList.contains('open'), false); assert.ok(f.document.querySelector('[data-modal-motion=exit]'));
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    f.records.forEach(record => record.finish()); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    applyModalAnimation(f.document.documentElement, { style: 'none', duration: 500 });
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog); assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    applyModalAnimation(f.document.documentElement, { style: 'crt', duration: 500 });
    showModal(f.dialog); await Promise.resolve();
    Object.defineProperty(f.document, 'visibilityState', { configurable: true, value: 'hidden' });
    f.document.dispatchEvent(new f.dom.window.Event('visibilitychange')); f.tick(30000);
    assert.equal(f.dialog.open, true); assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    f.owner.dispose(); assert.equal(f.dialog.open, true);
  } finally { f.dispose(); }
});
