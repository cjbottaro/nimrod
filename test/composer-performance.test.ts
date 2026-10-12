import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { webviewHtml, rendererBundle } from './view-fixture';
import { SessionDrafts } from '../src/pi/session-drafts';
import { renderPrimaryAction } from '../src/pi/composer-dom';

test('draft edits persist immediately but coalesce geometry and retain status/control DOM', () => {
  const dom = new JSDOM(webviewHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  win.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  let persisted: any;
  let receive: (message: unknown) => void = () => {};
  Object.assign(win, { testHost: { getState: () => undefined, setState: (value: unknown) => { persisted = value; },
    postMessage() {}, onMessage: (listener: typeof receive) => { receive = listener; } } });
  win.eval(rendererBundle() + '\nwindow.testView = PiView.mountPiView(window.testHost);');
  const view = (win as unknown as { testView: { setActive(value: boolean): void; dispose(): void } }).testView;
  const flush = () => { while (frames.size) for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } };
  try {
    receive({ type: 'snapshot', state: { status: 'Ready', sessionUnavailable: false, messages: [], extensionStatuses: { fixture: 'Offline status' } } });
    flush();
    const input = win.document.querySelector<HTMLTextAreaElement>('#prompt')!;
    const sendIcon = win.document.querySelector('#send svg');
    const status = win.document.querySelector('#extension-activity')!.firstChild;
    let reads = 0;
    Object.defineProperty(input, 'scrollHeight', { get: () => { reads++; return 60; } });
    for (const value of ['a', 'ab', 'abc']) {
      input.value = value;
      input.dispatchEvent(new win.Event('input'));
      assert.equal(persisted.draft, value, 'durability is not debounced');
    }
    assert.equal(reads, 0);
    assert.equal(frames.size, 1);
    assert.equal(win.document.querySelector('#send svg'), sendIcon);
    assert.equal(win.document.querySelector('#extension-activity')!.firstChild, status);
    flush();
    assert.equal(reads, 1);
    assert.equal(input.style.height, '60px');

    input.value = 'abcd'; input.dispatchEvent(new win.Event('input'));
    assert.equal(frames.size, 1);
    view.setActive(false);
    assert.equal(frames.size, 0, 'hidden sessions cancel pending measurements');
    input.value = 'hidden edit'; input.dispatchEvent(new win.Event('input'));
    assert.equal(frames.size, 0);
    assert.equal(persisted.draft, 'hidden edit');
    view.setActive(true);
    assert.equal(reads, 2, 'selection sizes the latest draft synchronously');
    input.value = 'dispose'; input.dispatchEvent(new win.Event('input'));
    view.dispose();
    assert.equal(frames.size, 0, 'disposal cancels pending geometry work');
  } finally { dom.window.close(); }
});

test('unchanged primary actions retain their icon across snapshots', () => {
  const dom = new JSDOM('<button></button>');
  try {
    const button = dom.window.document.querySelector('button')!;
    const ready = { mainBusy: false, preparing: false, sessionUnavailable: false };
    renderPrimaryAction(button, ready);
    const icon = button.firstChild;
    renderPrimaryAction(button, { ...ready, preparing: true });
    assert.equal(button.firstChild, icon);
    assert.equal(button.disabled, true);
    renderPrimaryAction(button, { ...ready, mainBusy: true });
    assert.notEqual(button.firstChild, icon);
    assert.equal(button.disabled, false);
  } finally { dom.window.close(); }
});

test('temporary draft edits do not flush saved siblings; persistent edits still do', () => {
  let writes = 0;
  let saved: any;
  const library = new SessionDrafts({ drafts: { 'file:/saved': { draft: 'retained' } } }, undefined, value => { writes++; saved = value; });
  const temporary = library.fork();
  temporary.select('temporary:/project:fixture');
  for (const draft of ['a', 'ab', 'abc']) temporary.write({ draft });
  assert.equal(writes, 0);
  assert.deepEqual(temporary.read(), { draft: 'abc' });
  library.select('file:/saved');
  library.write({ draft: 'updated' });
  assert.equal(writes, 1);
  assert.deepEqual(saved.drafts, { 'file:/saved': { draft: 'updated' } });
  assert.deepEqual(temporary.read(), { draft: 'abc' });
});
