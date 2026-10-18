import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installComposerHints, newlineHint, sendHint } from '../src/composer-hints';

function fixture() {
  const dom = new JSDOM('<textarea></textarea><div></div><button>Other</button>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const prompt = document.querySelector('textarea')!;
  const container = document.querySelector('div')!;
  const controller = new dom.window.AbortController();
  let enabled = true;
  const hints = installComposerHints(prompt, container, { enabled: () => enabled, signal: controller.signal });
  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
    const event = new dom.window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    prompt.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'feedback never consumes keyboard behavior');
  };
  const active = () => [...container.querySelectorAll('.composer-hint-active')].map(node => node.textContent);
  return { dom, document, prompt, container, controller, hints, key, active, disable: () => { enabled = false; } };
}

test('modifier feedback is focus-scoped, exact, text-independent and mutation-free when unchanged', () => {
  const f = fixture();
  try {
    const contributions = [sendHint, { text: 'Custom localized queue label', modifiers: ['alt'] as const }, newlineHint];
    f.hints.render(contributions);
    const text = f.container.textContent;
    f.key('keydown', { key: 'Shift', shiftKey: true });
    assert.deepEqual(f.active(), []);
    f.prompt.focus();
    f.key('keydown', { key: 'Shift', shiftKey: true });
    assert.deepEqual(f.active(), [newlineHint.text]);
    const node = f.container.lastChild;
    const observer = new f.dom.window.MutationObserver(() => {});
    observer.observe(f.container, { attributes: true, childList: true, subtree: true });
    f.key('keydown', { key: 'A', shiftKey: true });
    f.key('keydown', { key: 'Shift', shiftKey: true, repeat: true });
    f.hints.render(contributions.map(hint => ({ ...hint })));
    assert.equal(f.container.lastChild, node);
    assert.equal(observer.takeRecords().length, 0, 'ordinary typing/repeated keys never repaint hints');
    observer.disconnect();
    f.key('keydown', { key: 'Alt', shiftKey: true, altKey: true });
    assert.deepEqual(f.active(), [], 'extra modifiers must not imply a different shortcut');
    f.key('keyup', { key: 'Shift', altKey: true });
    assert.deepEqual(f.active(), ['Custom localized queue label']);
    f.key('keydown', { key: 'Meta', altKey: true, metaKey: true });
    assert.deepEqual(f.active(), []);
    f.key('keyup', { key: 'Meta', altKey: true });
    f.key('keyup', { key: 'Alt' });
    assert.deepEqual(f.active(), []);
    assert.equal(f.container.textContent, text, 'feedback changes neither text nor typography');
    f.hints.render([{ text: '<not HTML>', modifiers: ['control', 'shift'] }]);
    f.key('keydown', { key: 'Control', ctrlKey: true, shiftKey: true });
    assert.deepEqual(f.active(), ['<not HTML>'], 'future modifier combinations need only metadata');
    assert.equal(f.container.querySelector('not'), null);
    f.hints.render('Status-only hint');
    assert.deepEqual(f.active(), []);
  } finally { f.dom.window.close(); }
});

test('feedback clears on focus loss, window blur, visibility, suspension, IME and disposal', () => {
  const f = fixture();
  try {
    const hold = () => {
      f.prompt.focus();
      f.key('keydown', { key: 'Shift', shiftKey: true });
      assert.deepEqual(f.active(), [newlineHint.text]);
    };
    f.hints.render([sendHint, newlineHint]);
    hold();
    f.document.querySelector('button')!.focus();
    assert.deepEqual(f.active(), []);
    f.prompt.focus();
    assert.deepEqual(f.active(), [], 'refocus cannot restore stale held modifiers');
    hold(); f.dom.window.dispatchEvent(new f.dom.window.Event('blur'));
    assert.deepEqual(f.active(), []);
    f.key('keyup', { key: 'Alt', shiftKey: true });
    assert.deepEqual(f.active(), [], 'background key events cannot revive emphasis');
    f.dom.window.dispatchEvent(new f.dom.window.Event('focus'));
    assert.deepEqual(f.active(), []);
    hold();
    Object.defineProperty(f.document, 'hidden', { configurable: true, value: true });
    f.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
    assert.deepEqual(f.active(), []);
    Object.defineProperty(f.document, 'hidden', { configurable: true, value: false });
    hold(); f.hints.reset(); assert.deepEqual(f.active(), []);
    hold(); f.prompt.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart'));
    assert.deepEqual(f.active(), []);
    f.key('keydown', { key: 'Shift', shiftKey: true, isComposing: true });
    assert.deepEqual(f.active(), []);
    f.prompt.dispatchEvent(new f.dom.window.CompositionEvent('compositionend'));
    hold(); f.disable(); f.hints.render([sendHint, newlineHint]);
    assert.deepEqual(f.active(), [], 'locking the prompt clears emphasis without waiting for keyup');
  } finally { f.dom.window.close(); }
  const disposed = fixture();
  try {
    disposed.hints.render([newlineHint]); disposed.prompt.focus();
    disposed.key('keydown', { key: 'Shift', shiftKey: true });
    disposed.controller.abort();
    assert.deepEqual(disposed.active(), []);
    disposed.key('keydown', { key: 'Shift', shiftKey: true });
    assert.deepEqual(disposed.active(), [], 'disposed listeners cannot revive emphasis');
  } finally { disposed.dom.window.close(); }
});
