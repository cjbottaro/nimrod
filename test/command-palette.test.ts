import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installCommandPalette, type PalettePage } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';
import { sessionIndicator, sessionTime, type SidebarState } from '../src/session-sidebar';

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

test('session row options share indicators and muted timestamps without visible status text', async () => {
  const states: SidebarState[] = [{}, { inactive: true }, { busy: true }, { compacting: true }, { pending: true },
    { unread: true }, { inputCount: 1 }, { failed: true }, { starting: true }, { restarting: true },
    { closing: true }, { deleting: true }, { blocked: true }];
  const timestamp = Date.now() - 120_000;
  const f = fixture(async () => ({ items: states.map((state, index) => ({
    id: `session-${index}`, label: `Conversation ${index}`, sessionRow: { timestamp, indicator: sessionIndicator(state) }, run() {},
  })) }));
  try {
    await f.palette.sessions();
    for (const [index, row] of [...f.list().children].entries()) {
      const status = sessionIndicator(states[index]);
      assert.ok(row.classList.contains('session-row'));
      assert.equal(row.querySelector<HTMLElement>('.session-indicator')!.dataset.state, status.state);
      assert.equal(row.querySelector('.session-indicator')!.textContent, status.mark);
      assert.equal(row.querySelector('.session-indicator')!.getAttribute('aria-hidden'), 'true');
      assert.equal(row.querySelector('.session-row-text > span')!.textContent, `Conversation ${index}`);
      assert.equal(row.querySelector('small > time')!.textContent, sessionTime(timestamp));
      assert.equal(row.querySelector('time')!.getAttribute('datetime'), new Date(timestamp).toISOString());
      assert.equal(row.getAttribute('aria-label'), `Conversation ${index} — ${status.label}`);
      assert.equal(row.getAttribute('aria-describedby'), row.querySelector('time')!.id);
      assert.ok(!row.textContent!.includes(status.label));
    }
    f.query('working');
    assert.equal(f.list().children.length, 1, 'status remains searchable without visible status text');
    assert.equal(f.list().firstElementChild!.getAttribute('aria-selected'), 'true');
  } finally { f.dispose(); }
});

test('every palette page shares one-step dismissal across entry points and cancellation paths', async () => {
  for (const page of ['commands', 'resume', 'switch', 'selection', 'name']) {
    for (const entry of ['direct', 'palette']) {
      for (const cancellation of ['keyboard', 'native', 'api']) {
        const f = fixture();
        try {
          if (entry === 'palette') { f.palette.open(); f.query('remember me'); }
          let choice: Promise<string | undefined> | undefined;
          if (page === 'commands') { if (entry === 'direct') f.palette.open(); }
          else if (page === 'resume') await f.palette.sessions();
          else if (page === 'switch') await f.palette.openSessions();
          else if (page === 'name') { f.palette.namedSession(name => { f.calls.push(name); }); f.query('Discard me'); }
          else {
            // Any future selection feature gets the same lifecycle, without an
            // Escape handler or knowledge of how the user reached it.
            const request = f.palette.startSelection('Future feature', () => { f.calls.push('retry'); })!;
            choice = request.choose(['First', 'Second']);
          }
          assert.equal(f.dialog.open, true);
          if (cancellation === 'keyboard') {
            const target = f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!;
            target.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          } else if (cancellation === 'native') {
            const event = new f.win.Event('cancel', { cancelable: true });
            f.dialog.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
          } else f.palette.close();
          assert.equal(f.dialog.open, false, `${page}/${entry}/${cancellation}`);
          if (choice) assert.equal(await choice, undefined);
          await tick(); assert.deepEqual(f.calls, []);
          assert.equal(f.win.document.activeElement, f.opener);
          f.palette.open(); assert.equal(f.input.value, '');
        } finally { f.dispose(); }
      }
    }
  }
});

test('selection Back cancels pending choices but retains the interaction and command query', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.query('remember');
    const request = f.palette.startSelection('Select model', () => {})!;
    const choice = request.choose(['one']);
    f.win.document.querySelector<HTMLButtonElement>('#palette-back')!.click();
    assert.equal(await choice, undefined);
    assert.equal(f.dialog.open, true); assert.equal(f.input.value, 'remember');
    assert.equal(await request.choose(['stale']), undefined);
    request.cancel(); assert.equal(f.dialog.open, true, 'old page cannot dismiss commands');
  } finally { f.dispose(); }
});

test('dismissal invalidates choices before the native close event is delivered', async () => {
  const f = fixture();
  try {
    const request = f.palette.startSelection('Select model', () => {})!;
    const choice = request.choose(['one']);
    f.dialog.close = () => { f.dialog.removeAttribute('open'); };
    request.cancel();
    assert.equal(await choice, undefined);
    assert.equal(await request.choose(['stale']), undefined);
    request.error('stale'); assert.doesNotMatch(f.status()!, /stale/);
    assert.equal(f.palette.open(), false, 'wait for native close before a new interaction');
    assert.equal(f.palette.startSelection('New picker', () => {}), undefined);
    f.dialog.dispatchEvent(new f.win.Event('close'));
    assert.equal(f.win.document.activeElement, f.opener);
    assert.equal(f.palette.open(), true);
  } finally { f.dispose(); }
});

test('session badges are separate, searchable text and do not change activation', async () => {
  const chosen: string[] = [];
  const f = fixture(async () => ({ items: [
    { id: 'a', label: 'A very long title', sessionRow: { timestamp: 100, indicator: sessionIndicator({ busy: true }), badge: 'Open' }, keywords: 'A very long preview /sessions/a.jsonl', run: () => { chosen.push('a'); } },
    { id: 'b', label: 'Closed session', sessionRow: { timestamp: undefined, indicator: sessionIndicator({ inactive: true }) }, run: () => { chosen.push('b'); } },
  ] }));
  try {
    await f.palette.sessions();
    assert.equal(f.list().querySelectorAll('.session-row').length, 2);
    assert.equal(f.list().querySelectorAll('.session-row-badge').length, 1);
    assert.equal(f.list().querySelector('.session-row-heading .session-row-badge')!.textContent, 'Open');
    assert.equal(f.list().querySelector('small')!.textContent, sessionTime(100));
    assert.equal(f.list().children[0].getAttribute('aria-label'), 'A very long title — Working — Open');
    assert.equal(f.list().children[1].querySelector('small')!.textContent, 'No message time');
    assert.equal(f.list().children[0].getAttribute('title'), null);
    f.query('preview a.jsonl'); assert.equal(f.list().children.length, 1);
    f.query('open working'); assert.equal(f.list().children.length, 1);
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

test('preference picker marks current option, dismisses on Escape and ignores stale loads', async () => {
  const f = fixture();
  try {
    const old = f.palette.startSelection('Select model', () => {})!;
    const choice = old.choose(['one', 'two'], 'two');
    assert.equal(f.input.getAttribute('aria-activedescendant'), f.list().children[1].id);
    assert.equal(f.list().children[1].getAttribute('aria-current'), 'true');
    assert.deepEqual([...f.list().querySelectorAll('.palette-selection-marker')].map(marker => marker.textContent), ['', '•']);
    assert.equal(f.list().querySelector('.session-indicator, small'), null);
    f.key('ArrowUp');
    assert.equal(f.list().children[0].getAttribute('aria-selected'), 'true');
    assert.equal(f.list().children[1].getAttribute('aria-current'), 'true');
    assert.equal(f.list().children[1].querySelector('.palette-selection-marker')!.textContent, '•');
    f.key('Escape'); assert.equal(await choice, undefined);
    assert.equal(f.dialog.open, false); assert.equal(f.win.document.activeElement, f.opener);
    assert.equal(await old.choose(['stale']), undefined);
    old.error('stale error'); assert.doesNotMatch(f.status()!, /stale/);
    const current = f.palette.startSelection('Select thinking level', () => {})!;
    const selected = current.choose(['low', 'high'], 'low');
    assert.deepEqual([...f.list().querySelectorAll('.palette-selection-marker')].map(marker => marker.textContent), ['•', '']);
    f.query('high');
    assert.equal(f.list().querySelector('.palette-selection-marker')!.textContent, '');
    assert.equal(f.list().querySelector('[aria-current]'), null);
    f.key('Enter'); await tick();
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

test('explicit Back returns to the command query; Escape closes and restores focus', async () => {
  const f = fixture();
  try {
    f.palette.open(); f.query('res'); f.key('Enter'); await tick();
    f.query('missing'); f.key('Enter'); assert.equal(f.dialog.open, true);
    f.win.document.querySelector<HTMLButtonElement>('#palette-back')!.click();
    assert.equal(f.input.value, 'res'); assert.equal(f.dialog.open, true);
    f.key('Escape'); assert.equal(f.dialog.open, false); assert.equal(f.win.document.activeElement, f.opener);
    assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

test('late session results cannot overwrite commands or a newer picker request', async () => {
  const finish: ((page: PalettePage) => void)[] = [];
  const f = fixture(() => new Promise(resolve => finish.push(resolve)));
  try {
    void f.palette.sessions(); f.win.document.querySelector<HTMLButtonElement>('#palette-back')!.click();
    finish[0]({ items: [{ id: 'old', label: 'Obsolete session', run() {} }] }); await tick();
    assert.equal(f.win.document.querySelector('#palette-title')!.textContent, 'Commands');
    assert.doesNotMatch(f.list().textContent!, /Obsolete/);
    void f.palette.sessions(); f.key('Escape'); assert.equal(f.dialog.open, false);
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
