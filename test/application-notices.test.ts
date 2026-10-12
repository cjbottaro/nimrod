import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { NoticeStore, installApplicationNotices } from '../src/application-notices';
import { stubDialogs } from './dialog-fixture';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('causal propagation has one visible notice; resolving uncertainty does not erase the underlying connection issue', () => {
  const store = new NoticeStore();
  store.report({ id: 'connection', owner: 'one', cause: 'disconnect', operation: 'Connection', message: 'Disconnected', priority: 10 });
  store.report({ id: 'delivery', owner: 'one', cause: 'disconnect', operation: 'Send', message: 'Acceptance unknown', priority: 100, dismissible: false });
  store.report({ id: 'transport', owner: 'one', cause: 'disconnect', operation: 'RPC', message: 'Pipe closed' });
  assert.deepEqual(store.notices.map(notice => notice.id), ['delivery']);
  store.dismiss('delivery'); assert.equal(store.notices[0].id, 'delivery');
  store.resolve('delivery'); assert.equal(store.notices[0].id, 'connection');
  store.report({ id: 'other', owner: 'two', cause: 'disconnect', operation: 'Connection', message: 'Disconnected' });
  assert.equal(store.notices.length, 2);
  store.dismiss('connection'); assert.deepEqual(store.notices.map(notice => notice.id), ['other']);
});

test('independent identical errors remain separate; unchanged reports refresh actions without publishing again', () => {
  const store = new NoticeStore(); let updates = 0;
  store.subscribe(() => updates++);
  const first = { id: 'one', operation: 'Save', message: 'Failed' };
  store.report(first); store.report(first); assert.equal(updates, 1);
  store.report({ ...first, id: 'two' }); assert.equal(store.notices.length, 2);
  store.dismiss('one'); assert.equal(store.notices[0].id, 'two');
  store.report(first); assert.equal(store.notices.length, 1, 'unchanged monitor reports cannot resurrect a dismissed notice');
  store.resolve('one'); store.report(first); assert.equal(store.notices.length, 2, 'explicit issue resolution ends dismissal suppression');
});

test('strip portals into the active modal without stealing focus, preserves row identity and restores prior control on dismissal', async () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header><textarea id="prompt"></textarea><dialog id="settings"><input id="runtime"></dialog><dialog id="nested"><input id="nested-input"></dialog></body>', { pretendToBeVisual: true });
  const win = dom.window; stubDialogs(win);
  const ui = installApplicationNotices(win as unknown as Window);
  try {
    const prompt = win.document.querySelector<HTMLTextAreaElement>('#prompt')!; prompt.focus();
    ui.report({ id: 'save', operation: 'Save draft', message: 'Failed' });
    assert.equal(win.document.activeElement, prompt);
    const row = ui.strip.querySelector('.application-notice');
    ui.report({ id: 'save', operation: 'Save draft', message: 'Failed' }); assert.equal(ui.strip.querySelector('.application-notice'), row);
    const settings = win.document.querySelector<HTMLDialogElement>('#settings')!, field = win.document.querySelector<HTMLInputElement>('#runtime')!;
    settings.showModal(); field.focus(); await turn();
    assert.equal(ui.strip.parentElement, settings); assert.equal(win.document.activeElement, field);
    const nested = win.document.querySelector<HTMLDialogElement>('#nested')!, inner = win.document.querySelector<HTMLInputElement>('#nested-input')!;
    nested.showModal(); inner.focus(); await turn(); assert.equal(ui.strip.parentElement, nested); assert.equal(win.document.activeElement, inner);
    nested.close(); await turn(); assert.equal(ui.strip.parentElement, settings);
    field.focus(); const dismiss = ui.strip.querySelector<HTMLButtonElement>('button')!; dismiss.focus(); dismiss.click();
    assert.equal(ui.strip.hidden, true); assert.equal(win.document.activeElement, field);
  } finally { ui.dispose(); win.close(); }
});

test('an action is revalidated at its execution boundary and errors stay scoped to that action', async () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header><input></body>', { pretendToBeVisual: true });
  const ui = installApplicationNotices(dom.window as unknown as Window);
  let enabled = true, runs = 0;
  try {
    ui.report({ id: 'action', owner: 'session', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', enabled: () => enabled, run: () => { runs++; } }] });
    ui.strip.querySelector<HTMLButtonElement>('button')!.click(); enabled = false; await turn(); assert.equal(runs, 0);
    ui.resolve('action'); ui.report({ id: 'throwing', owner: 'session', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', run: () => { throw new Error('fixture retry failed'); } }] });
    ui.strip.querySelector<HTMLButtonElement>('button')!.click(); await turn();
    assert.match(ui.strip.textContent!, /fixture retry failed/); assert.equal(ui.store.notices.length, 2);
  } finally { ui.dispose(); dom.window.close(); }
});
