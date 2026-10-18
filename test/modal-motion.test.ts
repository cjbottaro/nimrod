import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyModalAnimation } from '../src/modal-animation';
import { closeModal, installModalMotion, showModal, showModalOverlay, closeModalOverlay } from '../src/modal-motion';
import { stubDialogs } from './dialog-fixture';

function fixture(style: 'crt' | 'subtle' | 'hologram' = 'crt') {
  const dom = new JSDOM('<style>#sample { background:rgb(30,40,50); } .nimrod-modal { clip-path:none; }</style><button id="opener">Open</button><dialog id="sample" class="nimrod-modal"><form method="dialog"><textarea id="field"></textarea><button>Close</button></form></dialog>', { pretendToBeVisual: true });
  const { document } = dom.window;
  stubDialogs(dom.window);
  const getStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.getComputedStyle = element => getStyle(element);
  const timeline = { currentTime: null as number | null };
  Object.defineProperty(document, 'timeline', { value: timeline });
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
  dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  const tick = (timestamp: number) => { timeline.currentTime = timestamp; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(timestamp)); };
  const timers: number[] = [], setTimeout = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (handler, delay, ...args) => { timers.push(delay ?? 0); return setTimeout(handler, delay, ...args); };
  const records: { node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; paused: boolean; startTime: number | null; currentTime: number | null; finish(): void }[] = [];
  dom.window.HTMLElement.prototype.animate = function (frames, options) {
    let resolve!: () => void;
    const finished = new Promise<void>(done => { resolve = done; });
    const record = { node: this as HTMLElement, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, cancelled: false, paused: false, startTime: null as number | null, currentTime: null as number | null, finish: () => resolve() };
    records.push(record);
    return { finished, cancel: () => { record.cancelled = true; }, pause: () => { record.paused = true; }, play: () => { record.paused = false; },
      get currentTime() { return record.currentTime; }, set currentTime(value: number | null) { record.currentTime = value; },
      get startTime() { return record.startTime; }, set startTime(value: number | null) { record.startTime = value; },
    } as unknown as Animation;
  };
  applyModalAnimation(document.documentElement, { style, duration: 500 });
  const owner = installModalMotion(document), dialog = document.querySelector('dialog')!;
  dialog.getBoundingClientRect = () => new dom.window.DOMRect(20, 40, 620, 240);
  const opener = document.getElementById('opener')!;
  const dispose = () => { owner.dispose(); dom.window.close(); };
  return { dom, document, records, owner, dialog, opener, dispose, tick, timers };
}

test('closing is immediate, exit copies are inert and isolated, and new opens remove old decoration', async () => {
  const f = fixture();
  try {
    f.opener.focus(); showModal(f.dialog); await Promise.resolve();
    const field = f.document.querySelector<HTMLTextAreaElement>('#field')!;
    field.value = 'Current edited text'; field.focus();
    closeModal(f.dialog, 'cancel');
    assert.equal(f.dialog.open, false);
    assert.equal(f.dialog.returnValue, 'cancel');
    assert.equal(f.document.activeElement, f.opener);
    const layer = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
    assert.equal(layer.inert, true); assert.equal(layer.getAttribute('aria-hidden'), 'true');
    assert.equal(layer.style.pointerEvents, 'none');
    const snapshot = [...layer.children].find(node => node.shadowRoot)!.shadowRoot!;
    assert.equal(snapshot.querySelector<HTMLTextAreaElement>('[data-modal-snapshot-id=field]')!.value, 'Current edited text');
    assert.equal(snapshot.querySelectorAll('[id]').length, 0);
    assert.equal(f.document.querySelectorAll('#sample').length, 1);
    const exits = f.records.filter(record => layer.contains(record.node));
    assert.ok(exits.every(record => record.options.duration === 400 && record.options.direction === 'reverse'));
    assert.equal(exits.some(record => record.node === layer), false); // No whole-layer opacity fade.
    const panel = exits.find(record => record.node.shadowRoot)!;
    assert.ok(panel.frames.every(frame => !('opacity' in frame)));
    assert.equal(panel.frames[1].offset, .18); // Reverse the entrance hold and per-segment easing.
    assert.equal(panel.frames[1].easing, 'cubic-bezier(.2,.8,.2,1)');
    const enteringBeam = f.records.find(record => record.node.hasAttribute('data-modal-crt-line') && record.options.direction === 'normal')!;
    const exitingBeam = exits.find(record => record.node.hasAttribute('data-modal-crt-line'))!;
    assert.deepEqual(exitingBeam.frames, enteringBeam.frames);
    showModal(f.dialog);
    assert.equal(layer.isConnected, false);
    assert.equal(f.dialog.open, true);
    assert.equal(field.value, 'Current edited text');
  } finally { f.dispose(); }
});

test('hologram scans down once and reverses upward without panel fading or delaying closure', async () => {
  const f = fixture('hologram');
  try {
    f.opener.focus(); showModal(f.dialog); await Promise.resolve();
    const entering = f.records.find(record => record.node.hasAttribute('data-modal-hologram-line'))!;
    assert.equal(entering.options.duration, 500); assert.equal(entering.options.easing, 'linear');
    assert.equal(entering.node.style.height, '2px'); assert.equal(entering.node.style.top, '40px');
    assert.ok(entering.node.querySelector('[data-modal-hologram-trail]'));
    assert.equal(entering.frames[0].transform, 'translateY(-50%)');
    assert.equal(entering.frames.at(-1)!.transform, 'translateY(240px) translateY(-50%)');
    assert.ok(entering.frames.every(frame => frame.opacity === 1));
    assert.ok(f.records.every(record => record.paused && record.currentTime === 0));
    f.tick(10000); // Delayed first paint must still start every part at zero.
    assert.ok(f.records.every(record => record.startTime === 10000 && !record.paused));
    closeModal(f.dialog);
    assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.opener);
    const layer = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
    const exits = f.records.filter(record => layer.contains(record.node));
    assert.ok(exits.every(record => record.options.duration === 400 && record.options.direction === 'reverse'));
    assert.equal(exits.some(record => record.node === layer), false);
    const panel = exits.find(record => record.node.shadowRoot)!;
    assert.deepEqual(panel.frames, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }]);
    assert.deepEqual(exits.find(record => record.node.hasAttribute('data-modal-hologram-line'))!.frames, entering.frames);
    assert.ok(exits.every(record => record.paused && record.currentTime === 0));
    f.tick(20000);
    assert.ok(exits.every(record => record.startTime === 20000 && !record.paused));
    assert.equal(f.timers.length, 0); // No wall-clock deadline can truncate the scan.
    assert.equal(layer.isConnected, true);
    showModal(f.dialog); await Promise.resolve();
    f.dialog.style.clipPath = 'inset(0 0 50% 0)'; // Close halfway through reveal.
    closeModal(f.dialog);
    const partial = f.document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
    const partialBeam = f.records.find(record => partial.contains(record.node) && record.node.hasAttribute('data-modal-hologram-line'))!;
    assert.equal(partialBeam.frames.at(-1)!.transform, 'translateY(120px) translateY(-50%)');
    applyModalAnimation(f.document.documentElement, { style: 'none', duration: 500 });
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});

test('hidden documents cancel pending scan starts without closing the real dialog', async () => {
  const f = fixture('hologram');
  try {
    showModal(f.dialog); await Promise.resolve();
    assert.ok(f.records.some(record => record.paused));
    Object.defineProperty(f.document, 'visibilityState', { configurable: true, value: 'hidden' });
    f.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
    assert.equal(f.dialog.open, true);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    f.tick(10000);
    assert.ok(f.records.every(record => record.cancelled && record.startTime === null));
    closeModal(f.dialog);
    assert.equal(f.dialog.open, false);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});

test('native form/default cancel coverage does not change defaults, duplicate controlled closes, or animate prevented closes', async () => {
  const f = fixture('subtle');
  try {
    showModal(f.dialog); await Promise.resolve();
    const form = f.dialog.querySelector('form')!;
    const submit = new f.dom.window.Event('submit', { bubbles: true, cancelable: true });
    assert.equal(form.dispatchEvent(submit), true);
    // Trusted input can checkpoint here, before the browser's default action.
    // A microtask must not throw away the pre-close visual capture.
    await Promise.resolve();
    assert.equal(f.dialog.open, true);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 0);
    f.dialog.close('ok'); // Simulate the native method=dialog default.
    await Promise.resolve();
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    assert.ok(f.records.every(record => record.options.duration === 375)); // Subtle remains faster.
    showModal(f.dialog);
    const prevented = new f.dom.window.Event('cancel', { cancelable: true });
    f.dialog.addEventListener('cancel', event => event.preventDefault(), { once: true });
    f.dialog.dispatchEvent(prevented); await Promise.resolve();
    assert.equal(f.dialog.open, true);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 0);
    f.dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(f.dialog); }, { once: true });
    f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true })); await Promise.resolve();
    assert.equal(f.dialog.open, false);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    showModal(f.dialog);
    f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true }));
    await Promise.resolve(); // Same pre-default checkpoint for native Escape.
    f.dialog.close();
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
  } finally { f.dispose(); }
});

test('editor overlays settle synchronously and visual failure never prevents closing', async () => {
  const f = fixture();
  try {
    const overlay = f.document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="nimrod-modal"><textarea>Editor draft</textarea></div>';
    f.document.body.append(overlay);
    overlay.firstElementChild!.getBoundingClientRect = () => new f.dom.window.DOMRect(20, 40, 620, 240);
    showModalOverlay(overlay); await Promise.resolve();
    closeModalOverlay(overlay);
    assert.equal(overlay.classList.contains('open'), false);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    assert.equal(overlay.querySelector('textarea')!.value, 'Editor draft');
    showModal(f.dialog);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 0);
    f.dialog.getBoundingClientRect = () => { throw new Error('Decorative capture unavailable'); };
    closeModal(f.dialog, 'still-closes');
    assert.equal(f.dialog.open, false); assert.equal(f.dialog.returnValue, 'still-closes');
  } finally { f.dispose(); }
});

test('None, bounded legacy duration, preferences, disposal and finished animations preserve live dialogs', async () => {
  const f = fixture();
  try {
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    f.records.forEach(record => record.finish());
    await Promise.resolve(); await Promise.resolve();
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    applyModalAnimation(f.document.documentElement, { style: 'none', duration: 500 });
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    applyModalAnimation(f.document.documentElement, { style: 'crt', duration: 0 });
    assert.equal(f.document.documentElement.style.getPropertyValue('--modal-enter-duration'), '100ms');
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
    applyModalAnimation(f.document.documentElement, { style: 'crt', duration: 500 });
    showModal(f.dialog); await Promise.resolve(); f.owner.dispose();
    assert.equal(f.dialog.open, true);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});
