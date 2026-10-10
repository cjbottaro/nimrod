import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installCommandPalette, type PalettePage } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';

function fixture(load: () => Promise<PalettePage> = async () => ({ items: [] })) {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window; stubDialogs(win);
  const dialog = win.document.querySelector<HTMLDialogElement>('#command-palette')!;
  const input = win.document.querySelector<HTMLInputElement>('#palette-input')!;
  const opener = win.document.querySelector<HTMLButtonElement>('#open-settings')!; opener.focus();
  const calls: string[] = [];
  let allowed = true;
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => allowed,
    commands: () => [
      { id: 'resume', label: 'Resume session…', next: true, run: () => palette.sessions() },
      { id: 'switch', label: 'Switch session…', next: true, run: () => palette.openSessions() },
      { id: 'new', label: 'New session', run: () => { calls.push('new'); } },
      { id: 'named', label: 'New named session…', next: true, run: () => palette.namedSession(name => {
        assert.equal(dialog.open, false); assert.equal(win.document.activeElement, opener);
        calls.push(`named:${name}`);
      }) },
    ], sessions: load,
    openSessions: () => ({ items: [{ id: 'open-demo', label: 'Offline demo', detail: 'Ready', run: () => { calls.push('open-demo'); } }] }),
  });
  const key = (key: string, init: KeyboardEventInit = {}) => input.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const query = (value: string) => { input.value = value; input.dispatchEvent(new win.Event('input')); };
  return { dom, win, dialog, input, opener, palette, calls, key, query,
    list: () => win.document.querySelector('#palette-list')!, status: () => win.document.querySelector('#palette-status')!.textContent,
    allow: (value: boolean) => { allowed = value; },
    dispose: () => { palette.dispose(); win.close(); },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('session badges are separate, searchable text and do not change activation', async () => {
  const chosen: string[] = [];
  const f = fixture(async () => ({ items: [
    { id: 'a', label: 'A very long title', badge: 'Open', detail: 'A very long preview', run: () => { chosen.push('a'); } },
    { id: 'b', label: 'Closed session', run: () => { chosen.push('b'); } },
  ] }));
  try {
    await f.palette.sessions();
    assert.equal(f.list().querySelectorAll('.palette-item-badge').length, 1);
    assert.equal(f.list().querySelector('.palette-item-heading .palette-item-badge')!.textContent, 'Open');
    assert.equal(f.list().querySelector('small')!.textContent, 'A very long preview');
    f.query('open'); assert.equal(f.list().children.length, 1);
    f.key('Enter'); await tick(); assert.deepEqual(chosen, ['a']);
    assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('named-session step is single-line, compact and keyboard-submit waits for close', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.query('new named'); f.key('Enter');
    const create = f.win.document.querySelector<HTMLButtonElement>('#palette-create')!;
    assert.equal(f.dialog.open, true); assert.equal(f.input.type, 'text');
    assert.equal(f.input.getAttribute('role'), 'textbox');
    assert.equal(f.input.hasAttribute('aria-controls'), false);
    assert.equal(f.list().hasAttribute('hidden'), true);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#palette-back')!.hidden, true);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!.hidden, true);
    assert.equal(create.hidden, false); assert.equal(create.disabled, true);
    assert.equal(f.status(), 'Enter to create · Esc to cancel');
    assert.equal(f.win.document.activeElement, f.input);
    f.query('   '); f.key('Enter'); assert.equal(create.disabled, true); assert.equal(f.dialog.open, true);
    f.query('  Named work  '); assert.equal(create.disabled, false);
    f.key('Enter', { isComposing: true }); f.key('Enter', { repeat: true }); await tick();
    assert.deepEqual(f.calls, []); assert.equal(f.dialog.open, true);
    f.key('Enter'); f.key('Enter'); await tick();
    assert.deepEqual(f.calls, ['named:Named work']);
    f.palette.open();
    assert.equal(f.input.getAttribute('role'), 'combobox');
    assert.equal(f.input.getAttribute('aria-controls'), 'palette-list');
    assert.equal(f.list().hasAttribute('hidden'), false); assert.equal(create.hidden, true);
  } finally { f.dispose(); }
});

test('named-session Escape and native cancel close immediately without creating', async () => {
  const f = fixture();
  try {
    for (const native of [false, true]) {
      f.palette.open(); f.query('new named'); f.key('Enter'); f.query('Discard me');
      if (native) f.dialog.dispatchEvent(new f.win.Event('cancel', { cancelable: true }));
      else f.key('Escape');
      await tick(); assert.equal(f.dialog.open, false); assert.deepEqual(f.calls, []);
      assert.equal(f.win.document.activeElement, f.opener);
    }
  } finally { f.dispose(); }
});

test('inline Create uses the same action boundary and respects composition and higher-priority dialogs', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.query('new named'); f.key('Enter'); f.query('Pointer work');
    const create = f.win.document.querySelector<HTMLButtonElement>('#palette-create')!;
    f.input.dispatchEvent(new f.win.CompositionEvent('compositionstart')); create.click();
    assert.equal(f.dialog.open, true);
    f.input.dispatchEvent(new f.win.CompositionEvent('compositionend'));
    const host = f.win.document.querySelector<HTMLDialogElement>('#host-dialog')!;
    host.showModal(); create.click(); assert.deepEqual(f.calls, []); host.close();
    create.click(); create.click(); await tick();
    assert.deepEqual(f.calls, ['named:Pointer work']);
  } finally { f.dispose(); }
});

test('late history cannot overwrite naming and leaving the step clears its action', async () => {
  let finish!: (page: PalettePage) => void;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  try {
    void f.palette.sessions(); f.palette.namedSession(name => { f.calls.push(name); }); f.query('Keep this name');
    finish({ items: [{ id: 'stale', label: 'Stale history', run() {} }] }); await tick();
    assert.equal(f.input.value, 'Keep this name'); assert.equal(f.status(), 'Enter to create · Esc to cancel');
    await f.palette.openSessions();
    f.win.document.querySelector<HTMLButtonElement>('#palette-create')!.click(); await tick();
    assert.deepEqual(f.calls, []); assert.equal(f.input.getAttribute('role'), 'combobox');
  } finally { f.dispose(); }
});

test('preference picker marks current option, cancels on back and ignores stale loads', async () => {
  const f = fixture();
  try {
    const old = f.palette.startSelection('Select model', () => {})!;
    const choice = old.choose(['one', 'two'], 'two');
    assert.equal(f.input.getAttribute('aria-activedescendant'), f.list().children[1].id);
    assert.match(f.list().children[1].textContent!, /Current/);
    f.key('Escape'); assert.equal(await choice, undefined);
    assert.equal(await old.choose(['stale']), undefined);
    old.error('stale error'); assert.doesNotMatch(f.status()!, /stale/);
    const current = f.palette.startSelection('Select thinking level', () => {})!;
    const selected = current.choose(['low', 'high'], 'low');
    f.query('high'); f.key('Enter'); await tick();
    assert.equal(await selected, 'high'); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('command selection drills into a filtered picker and executes only the chosen session', async () => {
  const chosen: string[] = [];
  const f = fixture(async () => ({ items: [
    { id: 'a', label: 'Implement sidebar', detail: 'Layout work', keywords: '/sessions/a.jsonl', run: () => { chosen.push('a'); } },
    { id: 'b', label: 'Review changes', detail: 'Background sessions', keywords: '/sessions/b.jsonl', run: () => { chosen.push('b'); } },
  ] }));
  try {
    f.palette.open(); f.query('resume'); f.key('Enter'); await tick();
    assert.equal(f.list().children.length, 2);
    f.query('background b.jsonl'); assert.equal(f.list().children.length, 1);
    f.key('Enter'); await tick();
    assert.deepEqual(chosen, ['b']); assert.equal(f.dialog.open, false);
    assert.equal(f.win.document.activeElement, f.opener);
  } finally { f.dispose(); }
});

test('switch-session picker includes only open sessions without loading resume history', async () => {
  let historyLoads = 0;
  const f = fixture(async () => { historyLoads++; return { items: [{ id: 'closed', label: 'Closed session', run() {} }] }; });
  try {
    f.palette.open(); f.query('switch session'); f.key('Enter'); await tick();
    assert.equal(f.win.document.querySelector('#palette-title')!.textContent, 'Switch session');
    assert.equal(historyLoads, 0);
    assert.equal(f.list().textContent, 'Offline demoReady');
    f.key('Enter'); await tick();
    assert.deepEqual(f.calls, ['open-demo']);
  } finally { f.dispose(); }
});

test('Escape returns to command query before closing and restoring focus', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.query('res'); f.key('Enter'); await tick();
    f.query('missing'); f.key('Enter'); assert.equal(f.dialog.open, true);
    f.key('Escape'); assert.equal(f.input.value, 'res'); assert.equal(f.dialog.open, true);
    f.key('Escape'); assert.equal(f.dialog.open, false); assert.equal(f.win.document.activeElement, f.opener);
    assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

test('late session results cannot overwrite commands or a newer picker request', async () => {
  const finish: ((page: PalettePage) => void)[] = [];
  const f = fixture(() => new Promise(resolve => finish.push(resolve)));
  try {
    void f.palette.sessions(); f.key('Escape');
    finish[0]({ items: [{ id: 'old', label: 'Obsolete session', run() {} }] }); await tick();
    assert.equal(f.win.document.querySelector('#palette-title')!.textContent, 'Commands');
    assert.doesNotMatch(f.list().textContent!, /Obsolete/);
    void f.palette.sessions(); f.key('Escape'); f.key('Escape');
    void f.palette.sessions();
    finish[2]({ items: [{ id: 'new', label: 'Current result', run() {} }] }); await tick();
    finish[1]({ items: [{ id: 'old', label: 'Obsolete result', run() {} }] }); await tick();
    assert.match(f.list().textContent!, /Current result/); assert.doesNotMatch(f.list().textContent!, /Obsolete/);
  } finally { f.dispose(); }
});

test('loading failures are visible and refresh retries discovery, never an action', async () => {
  let attempts = 0;
  const f = fixture(async () => { if (++attempts === 1) throw new Error('unavailable'); return { items: [], notice: 'One file could not be read' }; });
  try {
    await f.palette.sessions(); assert.match(f.status()!, /unavailable.*Refresh/);
    f.key('Enter'); assert.equal(f.dialog.open, true);
    f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!.click(); await tick();
    assert.equal(attempts, 2); assert.equal(f.status(), 'One file could not be read'); assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

test('shortcut respects existing dialogs, readiness and IME composition', async () => {
  const f = fixture();
  try {
    const shortcut = (extra: KeyboardEventInit = {}) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true, ...extra }));
    f.allow(false); shortcut(); assert.equal(f.dialog.open, false);
    f.allow(true); shortcut({ isComposing: true }); assert.equal(f.dialog.open, false);
    const host = f.win.document.querySelector<HTMLDialogElement>('#host-dialog')!;
    host.showModal(); shortcut(); assert.equal(f.dialog.open, false); host.close();
    shortcut(); assert.equal(f.dialog.open, true);
    f.query('new'); f.key('Enter', { isComposing: true }); await tick(); assert.deepEqual(f.calls, []);
    f.key('Enter', { repeat: true }); await tick(); assert.deepEqual(f.calls, []);
    f.key('Enter'); await tick(); assert.deepEqual(f.calls, ['new']);
  } finally { f.dispose(); }
});

test('keyboard arrows wrap selection and pointer choice uses the same action path', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.key('ArrowUp');
    assert.equal(f.input.getAttribute('aria-activedescendant'), f.list().children[3].id);
    f.key('ArrowDown'); assert.equal(f.input.getAttribute('aria-activedescendant'), f.list().children[0].id);
    (f.list().children[2] as HTMLElement).click(); await tick();
    assert.deepEqual(f.calls, ['new']); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});
