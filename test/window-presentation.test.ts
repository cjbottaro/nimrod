import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installWindowPresentation } from '../src/window-presentation';

test('prepared presentation lays out/reveals once and disposes owned resources in reverse order', async () => {
  const dom = new JSDOM(''); const calls: string[] = [];
  const presentation = installWindowPresentation(dom.window as unknown as Window, {
    layout: () => calls.push('layout'), reveal: async () => { calls.push('reveal'); },
  });
  try {
    presentation.own(() => calls.push('first')); presentation.own(() => calls.push('second'));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const one = presentation.presentWhenPrepared(() => gate);
    const two = presentation.presentWhenPrepared(() => gate);
    assert.deepEqual(calls, []); release(); await Promise.all([one, two]);
    assert.deepEqual(calls, ['layout', 'reveal']);
    await presentation.presentWhenPrepared(async () => {}); assert.equal(calls.length, 2);
    presentation.dispose(); presentation.dispose(); assert.deepEqual(calls, ['layout', 'reveal', 'second', 'first']);
    presentation.own(() => calls.push('late')); assert.equal(calls.at(-1), 'late');
  } finally { presentation.dispose(); dom.window.close(); }
});

test('unload cancels pending first reveal, including resources acquired after the close', async () => {
  const dom = new JSDOM(''); let reveals = 0, cleanup = 0;
  const presentation = installWindowPresentation(dom.window as unknown as Window, { layout: () => {}, reveal: async () => { reveals++; } });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const pending = presentation.presentWhenPrepared(() => gate);
    dom.window.dispatchEvent(new dom.window.Event('unload'));
    presentation.own(() => { cleanup++; }); release(); await pending;
    assert.equal(reveals, 0); assert.equal(cleanup, 1); assert.equal(presentation.disposed, true);
  } finally { release(); presentation.dispose(); dom.window.close(); }
});

test('preparation errors permit an error fallback, but native presentation failures are never replayed', async () => {
  const dom = new JSDOM(''); let reveals = 0;
  const presentation = installWindowPresentation(dom.window as unknown as Window, { layout: () => {}, reveal: async () => { reveals++; throw new Error('native show failed'); } });
  try {
    await assert.rejects(presentation.presentWhenPrepared(async () => { throw new Error('prepare failed'); }), /prepare failed/);
    assert.equal(reveals, 0);
    await assert.rejects(presentation.presentWhenPrepared(async () => {}), /native show failed/);
    await presentation.presentWhenPrepared(async () => {}); assert.equal(reveals, 1);
  } finally { presentation.dispose(); dom.window.close(); }
});
