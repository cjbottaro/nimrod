import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { applyModalAnimation } from '../src/modal-animation';
import { closeModal, installModalMotion, showModal, showModalOverlay, closeModalOverlay } from '../src/modal-motion';
import { stubDialogs } from './dialog-fixture';

function fixture(style: 'crt' | 'subtle' = 'crt') {
  const dom = new JSDOM('<style>#sample { background:rgb(30,40,50); } .nimrod-modal { clip-path:none; }</style><button id="opener">Open</button><dialog id="sample" class="nimrod-modal"><form method="dialog"><textarea id="field"></textarea><button>Close</button></form></dialog>', { pretendToBeVisual: true });
  const { document } = dom.window;
  stubDialogs(dom.window);
  const getStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.getComputedStyle = element => getStyle(element);
  const records: { node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; finish(): void }[] = [];
  dom.window.HTMLElement.prototype.animate = function (frames, options) {
    let resolve!: () => void;
    const finished = new Promise<void>(done => { resolve = done; });
    const record = { node: this as HTMLElement, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, cancelled: false, finish: () => resolve() };
    records.push(record);
    return { finished, cancel: () => { record.cancelled = true; } } as unknown as Animation;
  };
  applyModalAnimation(document.documentElement, { style, duration: 500 });
  const owner = installModalMotion(document), dialog = document.querySelector('dialog')!;
  dialog.getBoundingClientRect = () => new dom.window.DOMRect(20, 40, 620, 240);
  const opener = document.getElementById('opener')!;
  const dispose = () => { owner.dispose(); dom.window.close(); };
  return { dom, document, records, owner, dialog, opener, dispose };
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
    const snapshot = layer.querySelector('div')!.shadowRoot!;
    assert.equal(snapshot.querySelector<HTMLTextAreaElement>('[data-modal-snapshot-id=field]')!.value, 'Current edited text');
    assert.equal(snapshot.querySelectorAll('[id]').length, 0);
    assert.equal(f.document.querySelectorAll('#sample').length, 1);
    assert.ok(f.records.filter(record => layer.contains(record.node)).every(record => record.options.duration === 375));
    showModal(f.dialog);
    assert.equal(layer.isConnected, false);
    assert.equal(f.dialog.open, true);
    assert.equal(field.value, 'Current edited text');
  } finally { f.dispose(); }
});

test('native form/default cancel coverage does not change defaults, duplicate controlled closes, or animate prevented closes', async () => {
  const f = fixture('subtle');
  try {
    showModal(f.dialog); await Promise.resolve();
    const form = f.dialog.querySelector('form')!;
    const submit = new f.dom.window.Event('submit', { bubbles: true, cancelable: true });
    assert.equal(form.dispatchEvent(submit), true);
    f.dialog.close('ok'); // Simulate the native method=dialog default.
    await Promise.resolve();
    assert.equal(f.document.querySelectorAll('[data-modal-motion=exit]').length, 1);
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

test('none/zero duration, preference changes, disposal and finished animations clean up without touching live dialogs', async () => {
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
    showModal(f.dialog); await Promise.resolve(); closeModal(f.dialog);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
    applyModalAnimation(f.document.documentElement, { style: 'crt', duration: 500 });
    showModal(f.dialog); await Promise.resolve(); f.owner.dispose();
    assert.equal(f.dialog.open, true);
    assert.equal(f.document.querySelectorAll('[data-modal-motion]').length, 0);
  } finally { f.dispose(); }
});
