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

test('session ownership controls placement and announcements, not notice lifetime', () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header><section id="one"><input></section><section id="two" hidden><input></section></body>', { pretendToBeVisual: true });
  const win = dom.window, store = new NoticeStore();
  const shell = installApplicationNotices(win as unknown as Window, store);
  const one = installApplicationNotices(win as unknown as Window, store, { owner: 'one', container: win.document.getElementById('one')! });
  const two = installApplicationNotices(win as unknown as Window, store, { owner: 'two', container: win.document.getElementById('two')! });
  try {
    one.setActive(true);
    store.report({ id: 'background', owner: 'two', operation: 'Pi operation', message: 'Background failure' });
    assert.equal(shell.strip.hidden, true); assert.equal(one.strip.hidden, true);
    assert.equal(two.strip.querySelector('.notice-announcement')!.textContent, '');
    assert.match(two.strip.textContent!, /Background failure/);
    one.setActive(false); two.setActive(true);
    assert.match(two.strip.querySelector('.notice-announcement')!.textContent!, /Background failure/);
    store.report({ id: 'window', operation: 'Read settings', message: 'Window failure' });
    assert.match(shell.strip.textContent!, /Window failure/);
    assert.doesNotMatch(shell.strip.textContent!, /Background failure/);
    assert.doesNotMatch(two.strip.textContent!, /Window failure/);
    store.resolve('window'); assert.equal(shell.strip.hidden, true);
    assert.equal(store.notices.length, 1, 'navigation and unrelated resolution retain the session error');
    two.setActive(false); two.setActive(true);
    assert.match(two.strip.textContent!, /Background failure/);
    store.resolveOwner('two'); assert.equal(two.strip.hidden, true);
  } finally { two.dispose(); one.dispose(); shell.dispose(); win.close(); }
});

test('multiple notices collapse to a bounded list; diagnostics and rows survive unchanged reports', () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header></body>', { pretendToBeVisual: true });
  const ui = installApplicationNotices(dom.window as unknown as Window);
  try {
    const notice = { id: 'one', operation: 'Launch', message: 'Could not start Pi', details: 'spawn /fixture/pi ENOENT' };
    ui.report(notice);
    const row = ui.strip.querySelector('.application-notice')!;
    const detail = row.querySelector('details')!;
    assert.equal(detail.open, false); detail.open = true;
    ui.report(notice);
    assert.equal(ui.strip.querySelector('.application-notice'), row);
    assert.equal(detail.open, true);
    ui.report({ id: 'two', operation: 'Save', message: 'Another failure' });
    const group = ui.strip.querySelector<HTMLDetailsElement>('.notice-group')!;
    assert.equal(group.open, false); assert.match(group.querySelector('summary')!.textContent!, /2 application issues/);
    group.open = true; ui.report(notice); assert.equal(group.open, true);
    ui.resolve('two'); assert.equal(group.open, true);
    assert.equal(detail.open, true); assert.equal(row, ui.strip.querySelector('.application-notice'));
  } finally { ui.dispose(); dom.window.close(); }
});

test('action failures from separate session renderers keep independent IDs and disposed owners cannot report or execute', async () => {
  const dom = new JSDOM('<body><section id="one"></section><section id="two"></section></body>', { pretendToBeVisual: true });
  const win = dom.window, store = new NoticeStore();
  const one = installApplicationNotices(win as unknown as Window, store, { owner: 'one', container: win.document.getElementById('one')! });
  const two = installApplicationNotices(win as unknown as Window, store, { owner: 'two', container: win.document.getElementById('two')! });
  try {
    for (const owner of ['one', 'two']) store.report({ id: owner, owner, operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', run: () => { throw new Error(`${owner} retry failed`); } }] });
    one.strip.querySelector<HTMLButtonElement>('[data-action-index]')!.click();
    two.strip.querySelector<HTMLButtonElement>('[data-action-index]')!.click(); await turn();
    assert.equal(store.notices.length, 4);
    assert.match(one.strip.textContent!, /one retry failed/); assert.doesNotMatch(one.strip.textContent!, /two retry failed/);
    assert.match(two.strip.textContent!, /two retry failed/); assert.doesNotMatch(two.strip.textContent!, /one retry failed/);
    store.resolveOwner('two');
    let runs = 0;
    store.report({ id: 'stale', owner: 'two', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', run: () => { runs++; } }] });
    two.strip.querySelector<HTMLButtonElement>('[data-action-index]')!.click(); two.dispose(); await turn();
    assert.equal(runs, 0);
    store.resolveOwner('one');
    let reject!: (error: Error) => void;
    store.report({ id: 'late', owner: 'one', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', run: () => new Promise<void>((_resolve, failure) => { reject = failure; }) }] });
    one.strip.querySelector<HTMLButtonElement>('[data-action-index]')!.click(); await turn();
    one.dispose(); store.resolveOwner('one'); reject(new Error('late closed-owner failure')); await turn();
    assert.equal(store.notices.some(notice => notice.owner === 'one'), false);
  } finally { one.dispose(); two.dispose(); win.close(); }
});

test('new issues do not collapse a focused notice control; multiline details retain the original message', () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header></body>', { pretendToBeVisual: true });
  const ui = installApplicationNotices(dom.window as unknown as Window);
  try {
    ui.report({ id: 'one', operation: 'Launch', message: 'Could not start Pi\nspawn /fixture/pi ENOENT' });
    assert.equal(ui.strip.querySelector('.notice-message')!.textContent, 'Could not start Pi');
    assert.equal(ui.strip.querySelector('.notice-details > div')!.textContent, 'Could not start Pi\nspawn /fixture/pi ENOENT');
    const dismiss = ui.strip.querySelector<HTMLButtonElement>('[data-dismiss]')!; dismiss.focus();
    ui.report({ id: 'two', operation: 'Save', message: 'Another failure' });
    assert.equal(ui.strip.querySelector<HTMLDetailsElement>('.notice-group')!.open, true);
    assert.equal(dom.window.document.activeElement, dismiss);
  } finally { ui.dispose(); dom.window.close(); }
});

test('an action is revalidated at its execution boundary and errors stay scoped to that action', async () => {
  const dom = new JSDOM('<body><header id="workspace-bar"></header><input></body>', { pretendToBeVisual: true });
  const ui = installApplicationNotices(dom.window as unknown as Window, new NoticeStore(), { owner: 'session', container: dom.window.document.body });
  ui.setActive(true);
  let enabled = true, runs = 0;
  try {
    ui.report({ id: 'action', owner: 'session', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', enabled: () => enabled, run: () => { runs++; } }] });
    ui.strip.querySelector<HTMLButtonElement>('button')!.click(); enabled = false; await turn(); assert.equal(runs, 0);
    ui.resolve('action'); ui.report({ id: 'throwing', owner: 'session', operation: 'Connect', message: 'Failed', actions: [{ label: 'Retry', run: () => { throw new Error('fixture retry failed'); } }] });
    ui.strip.querySelector<HTMLButtonElement>('button')!.click(); await turn();
    assert.match(ui.strip.textContent!, /fixture retry failed/); assert.equal(ui.store.notices.length, 2);
  } finally { ui.dispose(); dom.window.close(); }
});
