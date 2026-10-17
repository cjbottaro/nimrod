import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installCommandPalette, type PalettePage, type PaletteOptions } from '../src/command-palette';
import { vscodeMruRanking, type CommandRanking } from '../src/command-ranking';
import { stubDialogs } from './dialog-fixture';
import { sessionIndicator, sessionTime, type SidebarState } from '../src/session-sidebar';

function fixture(load: () => Promise<PalettePage> = async () => ({ items: [] }), projects: (() => Promise<PalettePage>) | CommandRanking = load, ranking?: CommandRanking, history?: PaletteOptions['sessions'], deletion?: PaletteOptions['deleteSessions']) {
  if (typeof projects !== 'function') { ranking = projects; projects = load; }
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window; stubDialogs(win);
  const dialog = win.document.querySelector<HTMLDialogElement>('#command-palette')!;
  const input = win.document.querySelector<HTMLInputElement>('#palette-input')!;
  const opener = win.document.querySelector<HTMLButtonElement>('#open-settings')!; opener.focus();
  const calls: string[] = [];
  let allowed = true;
  const deleted = new Set<string>();
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => allowed,
    ranking,
    commands: () => [
      { id: 'resume', label: 'Resume session…', detail: 'Open a saved conversation', next: true, run: () => palette.sessions() },
      { id: 'switch', label: 'Switch session…', detail: 'Choose an open conversation', next: true, run: () => palette.openSessions() },
      { id: 'new', label: 'New session', detail: 'Start a persistent conversation', shortcut: '⌘+N', run: () => { calls.push('new'); } },
      { id: 'named', label: 'New named session…', detail: 'Choose a name before starting', next: true, run: () => palette.namedSession(name => {
        assert.equal(dialog.open, false); assert.equal(win.document.activeElement, opener);
        calls.push(`named:${name}`);
      }) },
    ], sessions: history ?? load, deleteSessions: deletion ?? load, sessionDeleted: id => deleted.has(id), projects,
    openSessions: () => ({ items: [{ id: 'open-demo', label: 'Offline demo', detail: 'Ready', run: () => { calls.push('open-demo'); } }] }),
  });
  const key = (key: string, init: KeyboardEventInit = {}) => input.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const query = (value: string) => { input.value = value; input.dispatchEvent(new win.Event('input')); };
  return { dom, win, dialog, input, opener, palette, calls, key, query, deleted,
    list: () => win.document.querySelector('#palette-list')!, status: () => win.document.querySelector('#palette-status')!.textContent,
    allow: (value: boolean) => { allowed = value; },
    dispose: () => { palette.dispose(); win.close(); },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('harness choice pages share selection mechanics without application Back/Retry or command ranking', async () => {
  const f = fixture();
  try {
    const request = f.palette.startSelection('Copilot permissions', () => { throw new Error('A command choice must not retry an invocation'); }, undefined, true)!;
    const choosing = request.chooseItems([{ id: 'show', label: 'show', detail: 'Show current permissions' },
      { id: 'reset', label: 'reset', detail: 'Clear approvals', keywords: 'restore defaults' }]);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#palette-back')!.hidden, true);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!.hidden, true);
    assert.match(f.list().textContent!, /Show current permissions/);
    f.query('restore defaults'); assert.match(f.list().textContent!, /reset/);
    f.key('Enter'); await tick();
    assert.equal(await choosing, 'reset'); assert.deepEqual(f.calls, []);
    assert.equal(f.dialog.open, false);
    const cancelled = f.palette.startSelection('Another choice', () => {}, undefined, true)!;
    const choice = cancelled.chooseItems([{ id: 'show', label: 'show' }]); f.key('Escape');
    assert.equal(await choice, undefined); cancelled.cancel();
    assert.equal(await cancelled.chooseItems([{ id: 'late', label: 'Late' }]), undefined);
  } finally { f.dispose(); }
});

test('retained selections update one open shell, retain context on count changes, and Escape invalidates every old callback', () => {
  const f = fixture();
  try {
    let dismissed = 0, opens = 0, closes = 0;
    const show = f.dialog.showModal.bind(f.dialog), close = f.dialog.close.bind(f.dialog);
    f.dialog.showModal = () => { opens++; show(); };
    f.dialog.close = value => { closes++; close(value); };
    const page = f.palette.startRetainedSelection('Permissions', () => { dismissed++; })!;
    const context = f.win.document.createElement('details'); context.textContent = 'Literal operation'; context.open = true;
    let selections = 0;
    page.show({ items: [{ id: 'once', label: 'Allow once', run: () => {
      selections++;
      page.show({ items: [{ id: 'deny', label: 'Deny', run: () => { selections++; page.cancel(); } }] }, context);
    } }] }, context);
    page.remaining('2 more');
    f.query('Allow'); const row = f.list().firstElementChild;
    page.remaining('3 more');
    assert.equal(f.input.value, 'Allow'); assert.equal(f.list().firstElementChild, row); assert.equal(context.open, true);
    f.key('Enter'); assert.equal(f.dialog.open, true); assert.equal(opens, 1); assert.equal(closes, 0); assert.equal(selections, 1);
    f.key('Enter', { repeat: true }); assert.equal(selections, 1);
    const stale = f.list().firstElementChild as HTMLElement;
    f.key('Escape'); assert.equal(dismissed, 1); assert.equal(closes, 1); assert.equal(page.isCurrent(), false);
    stale.click(); page.show({ items: [] }, context); assert.equal(selections, 1); assert.equal(f.dialog.open, false);
    assert.equal(f.win.document.querySelector('#palette-context')!.hasAttribute('hidden'), true);
  } finally { f.dispose(); }
});

test('accepting incremental deletion freezes discovery without rebuilding survivor rows on late pages', async () => {
  let request!: { signal: AbortSignal; publish(page: PalettePage): void; resolve(page: PalettePage): void };
  let finish!: () => void;
  const removing = new Promise<void>(resolve => { finish = resolve; });
  const page: PalettePage = { items: [
    { id: 'copilot', label: 'Copilot saved', async run() { await removing; f.deleted.add('copilot'); } },
    { id: 'pi', label: 'Pi survivor', run() {} },
  ], notice: 'Loading Copilot history…' };
  const f = fixture(undefined, undefined, undefined, undefined,
    (signal, publish) => new Promise(resolve => { request = { signal, publish, resolve }; }));
  try {
    const listing = f.palette.deleteSessions();
    request.publish(page);
    const survivor = f.list().children[1];
    f.key('Enter');
    assert.equal(request.signal.aborted, true);
    request.publish({ items: [] }); request.resolve(page);
    await listing;
    assert.equal(f.list().children[1], survivor);
    finish(); await tick();
    assert.equal(f.list().firstElementChild, survivor);
    assert.equal(f.list().children.length, 1);
    assert.equal(f.dialog.open, true);
    assert.match(f.status()!, /Refresh to finish/);
  } finally { finish(); f.dispose(); }
});

test('incremental history obeys query selection, refresh cancellation and stale-page guards', async () => {
  const requests: { signal: AbortSignal; publish: (page: PalettePage) => void; resolve: (page: PalettePage) => void }[] = [];
  const f = fixture(undefined, undefined, undefined, (signal, publish) => new Promise(resolve => { requests.push({ signal, publish, resolve }); }));
  const page: PalettePage = { items: [{ id: 'pi', label: 'Pi history', run() {} }] };
  try {
    const first = f.palette.sessions();
    requests[0].publish(page);
    assert.equal(f.list().children.length, 1);
    f.query('Pi');
    f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!.click();
    assert.equal(requests[0].signal.aborted, true);
    requests[0].publish({ items: [{ id: 'stale', label: 'Stale history', run() {} }] });
    requests[0].resolve(page);
    await first;
    assert.doesNotMatch(f.list().textContent!, /Stale history/);
    requests[1].publish(page);
    assert.equal(f.input.value, 'Pi');
    f.key('Escape'); await tick();
    assert.equal(requests[1].signal.aborted, true);
    requests[1].publish(page); requests[1].resolve(page); await tick();
    assert.equal(f.dialog.open, false);
    assert.equal(f.win.document.activeElement, f.opener);
  } finally { f.dispose(); }
});

test('inspection shares palette focus/cancellation, shows safe details and ignores stale reports', async () => {
  const f = fixture();
  try {
    let refreshes = 0, runs = 0;
    const request = f.palette.startInspection('MCP servers', () => { refreshes++; })!;
    request.show({ items: [
      { id: 'failed', label: 'Playwright', detail: 'codemode', badge: 'failed', inspection: { fields: [['Connection', 'failed']], text: '<script>not markup</script>\nsecond line' }, run() { runs++; } },
      { id: 'ready', label: 'ADO', detail: '40 tools · codemode', inspection: { fields: [['Tools', '40']] }, run() { runs++; } },
    ], notice: 'Read-only snapshot' });
    const details = () => f.win.document.querySelector('#palette-inspection')!;
    assert.match(details().textContent!, /Playwright/);
    assert.equal(details().querySelector('script'), null);
    assert.match(details().querySelector('pre')!.textContent!, /\nsecond line/);
    f.key('ArrowDown');
    assert.match(details().textContent!, /ADO/);
    f.key('Enter');
    assert.equal(f.dialog.open, true);
    assert.equal(runs, 0, 'inspection never executes row actions');
    f.query('Playwright');
    assert.match(details().textContent!, /Playwright/);
    f.win.document.querySelector<HTMLButtonElement>('#palette-refresh')!.click();
    assert.equal(refreshes, 1);
    f.key('Escape'); await tick();
    assert.equal(f.win.document.activeElement, f.opener);
    assert.equal(request.isCurrent(), false);
    request.show({ items: [], notice: 'stale' });
    assert.equal(f.dialog.open, false);
    f.palette.open();
    assert.equal((details() as HTMLElement).hidden, true);
    assert.equal(details().textContent, '');
    f.palette.close(); await tick();
  } finally { f.dispose(); }
});

test('preview selection shares cancellation lifecycle, mouse/arrow highlight and post-close acceptance', async () => {
  for (const cancel of ['escape', 'native', 'back', 'api', 'dispose'] as const) {
    const f = fixture(), previews: (string | undefined)[] = []; let restored = 0, accepted = 0;
    try {
      const request = f.palette.startPreviewSelection('Select theme', () => {}, item => previews.push(item?.id), () => { restored++; })!;
      request.show({ items: ['one', 'two'].map(id => ({ id, label: id, run: () => { accepted++; } })) }, 'one');
      const heading = f.list().children[0].querySelector('.palette-item-heading')!;
      assert.equal(heading.children[0].className, 'palette-item-label');
      assert.equal(heading.children[1].className, 'palette-selection-marker');
      f.key('ArrowDown'); assert.equal(previews.at(-1), 'two');
      f.list().children[0].dispatchEvent(new f.win.MouseEvent('mousemove', { bubbles: true }));
      assert.equal(previews.at(-1), 'one');
      f.query('no match'); assert.equal(previews.at(-1), undefined);
      if (cancel === 'escape') f.key('Escape');
      if (cancel === 'native') f.dialog.close();
      if (cancel === 'back') (f.win.document.querySelector('#palette-back') as HTMLButtonElement).click();
      if (cancel === 'api') request.cancel();
      if (cancel === 'dispose') f.palette.dispose();
      assert.equal(restored, 1); assert.equal(request.isCurrent(), false); assert.equal(accepted, 0);
      request.show({ items: [] }); assert.notEqual(f.status(), 'No options available.');
    } finally { f.dispose(); }
  }
  const f = fixture(); let restored = 0, accepted = 0;
  try {
    const request = f.palette.startPreviewSelection('Select theme', () => {}, () => {}, () => { restored++; })!;
    request.show({ items: [{ id: 'one', label: 'one', run: () => { accepted++; assert.equal(f.win.document.activeElement, f.opener); } }] });
    f.key('Enter'); f.key('Enter'); await tick();
    assert.equal(restored, 0); assert.equal(accepted, 1); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('delete picker retains its dialog and surviving DOM, prunes confirmed rows without catalog refresh', async () => {
  let finish!: () => void, loads = 0, runs = 0;
  const f = fixture(async () => { loads++; return { items: ['one', 'two', 'three', 'hidden'].map(id => ({
    id, label: `${id === 'hidden' ? 'Other' : 'Saved'} ${id}`,
    run: () => { runs++; return new Promise<void>(resolve => { finish = resolve; }); },
  })) }; });
  try {
    await f.palette.deleteSessions(); f.query('Saved'); f.key('ArrowDown');
    const rows = [...f.list().children]; f.list().scrollTop = 120;
    f.key('Enter'); f.key('Enter'); await tick();
    assert.equal(f.dialog.open, true); assert.equal(f.win.document.activeElement, f.input);
    assert.equal(runs, 1); assert.equal(f.input.readOnly, true);
    finish(); await tick();
    assert.equal(f.input.value, 'Saved'); assert.equal(f.input.readOnly, false);
    assert.equal(f.list().querySelector('[aria-selected="true"]')!.textContent, 'Saved two');
    assert.deepEqual([...f.list().children], rows); assert.equal(f.list().scrollTop, 120);
    f.key('Enter'); await tick(); f.deleted.add('two'); f.deleted.add('hidden'); finish(); await tick();
    assert.equal(f.list().children[0], rows[0]); assert.equal(f.list().children[1], rows[2]);
    assert.equal(f.list().querySelector('[aria-selected="true"]')!.textContent, 'Saved three');
    f.key('Enter'); await tick(); f.deleted.add('three'); finish(); await tick();
    assert.equal(f.list().querySelector('[aria-selected="true"]')!.textContent, 'Saved one');
    f.key('Enter'); await tick(); f.deleted.add('one'); finish(); await tick();
    assert.equal(f.dialog.open, true); assert.equal(f.list().children.length, 0); assert.match(f.status()!, /No sessions yet/);
    assert.equal(loads, 1); f.query(''); assert.equal(f.list().children.length, 0, 'hidden successes are pruned too');
    f.key('Escape'); await tick(); assert.equal(f.dialog.open, false); assert.equal(f.win.document.activeElement, f.opener);
  } finally { f.dispose(); }
});

test('delete return cannot overwrite a newer interaction or reopen after explicit close/disposal', async () => {
  for (const cancel of ['close', 'new', 'dispose'] as const) {
    let finish!: () => void;
    const f = fixture(async () => ({ items: [{ id: 'one', label: 'One', run: () => new Promise<void>(resolve => { finish = resolve; }) }] }));
    try {
      await f.palette.deleteSessions(); f.key('Enter'); await tick();
      if (cancel === 'new') { f.palette.close(); f.palette.open(); }
      else if (cancel === 'close') f.palette.close();
      else { f.palette.close(); f.palette.dispose(); }
      finish(); await tick();
      assert.equal(f.dialog.open, cancel === 'new');
      if (cancel === 'new') assert.equal(f.win.document.querySelector('#palette-title')!.textContent, 'Commands');
    } finally { f.dispose(); }
  }
});

test('partial deletion removes only successes and does not dismiss or refocus through a higher modal', async () => {
  let finish!: () => void, runs = 0;
  const f = fixture(async () => ({ items: ['root', 'sibling'].map(id => ({ id, label: id, run: () => { runs++; return new Promise<void>(resolve => { finish = resolve; }); } })) }));
  try {
    await f.palette.deleteSessions(); const root = f.list().children[0];
    f.key('Enter');
    const host = f.win.document.querySelector<HTMLDialogElement>('#host-dialog')!;
    host.tabIndex = -1; host.showModal(); host.focus();
    f.key('Escape'); f.key('Enter'); assert.equal(f.dialog.open, true); assert.equal(runs, 1);
    f.deleted.add('sibling'); finish(); await tick();
    assert.equal(f.list().children.length, 1); assert.equal(f.list().children[0], root);
    assert.equal(root.getAttribute('aria-selected'), 'true');
    assert.equal(f.win.document.activeElement, host);
    host.close(); f.key('Escape'); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});

test('delete action errors return to the picker without replay and stale discovery stays dismissed', async () => {
  let attempts = 0;
  const f = fixture(async () => ({ items: [{ id: 'one', label: 'One', run: () => { attempts++; throw new Error('Unavailable'); } }] }));
  try {
    await f.palette.deleteSessions(); f.key('Enter'); await tick();
    assert.equal(f.dialog.open, true); assert.match(f.status()!, /Unavailable/); assert.equal(attempts, 1);
    f.key('Escape'); await tick();
  } finally { f.dispose(); }
  let resolve!: (page: PalettePage) => void;
  const late = fixture(() => new Promise(done => { resolve = done; }));
  try {
    const pending = late.palette.deleteSessions(); late.key('Escape'); resolve({ items: [] }); await pending;
    assert.equal(late.dialog.open, false);
  } finally { late.dispose(); }
});

test('commands have descriptions below titles and shortcuts in the title row only', () => {
  const f = fixture();
  try {
    f.palette.open();
    for (const row of f.list().children) {
      assert.equal(row.children.length, 2);
      assert.ok(row.lastElementChild!.classList.contains('palette-item-description'));
      assert.ok(row.lastElementChild!.textContent?.trim());
    }
    f.query('persistent');
    const heading = f.list().firstElementChild!.firstElementChild!;
    assert.equal(heading.querySelector('kbd')!.textContent, '⌘+N');
    assert.equal(heading.lastElementChild!.tagName, 'KBD');
    f.query('Resume'); assert.equal(f.list().querySelector('kbd'), null);
    f.query('persistent'); assert.equal(f.list().children.length, 1);
  } finally { f.dispose(); }
});

test('project rows are inline dot/name/parent/Enter hints, searchable without a folder action', async () => {
  const f = fixture(undefined, async () => ({ items: [
    { id: '/work/nimrod', label: 'nimrod', detail: '/work/nimrod', projectParent: '/work', projectOpen: true, run: () => { f.calls.push('project'); } },
    { id: '/other/nimrod', label: 'nimrod', detail: '/other/nimrod', projectParent: '/other', projectOpen: false, run() {} },
  ] }));
  try {
    await f.palette.projects();
    assert.equal(f.input.placeholder, 'Search recent projects…');
    assert.equal(f.win.document.querySelector('#palette-browse, #palette-project-footer'), null);
    assert.equal(f.list().querySelector('.palette-item-badge'), null);
    assert.deepEqual([...f.list().querySelectorAll('.palette-selection-marker')].map(node => node.textContent), ['•', '']);
    for (const row of f.list().children) {
      assert.equal(row.children.length, 1, 'one inline heading, no subtitle');
      const heading = row.firstElementChild!;
      assert.deepEqual([...heading.children].map(node => node.classList[0]), ['palette-selection-marker', 'palette-item-label', 'palette-project-parent', 'picker-enter-hint']);
      assert.equal(heading.querySelector('svg')!.getAttribute('aria-hidden'), 'true');
      assert.match(row.getAttribute('aria-label')!, /Enter to open/);
      assert.equal(row.hasAttribute('aria-current'), false);
    }
    f.query('open'); assert.equal(f.list().children.length, 1);
    f.query('/work/nimrod'); assert.equal(f.list().children.length, 1, 'full canonical path remains searchable');
    assert.equal(f.list().querySelector('small')!.textContent, '/work');
    f.query('missing'); assert.equal(f.list().children.length, 0);
    f.key('Enter'); assert.deepEqual(f.calls, []);
    f.query('/work'); f.key('Enter'); await tick();
    assert.equal(f.dialog.open, false); assert.deepEqual(f.calls, ['project']);
  } finally { f.dispose(); }
});

test('late project discovery is discarded and empty picker directs users to native File Open', async () => {
  let resolveLoad!: (page: PalettePage) => void;
  const f = fixture(undefined, () => new Promise(resolve => { resolveLoad = resolve; }));
  try {
    const pending = f.palette.projects(); f.palette.close(); await tick();
    resolveLoad({ items: [] }); await pending; assert.equal(f.dialog.open, false);
    const next = f.palette.projects(); resolveLoad({ items: [] }); await next;
    assert.match(f.status()!, /No recent projects.*File → Open project/);
    assert.equal(f.win.document.querySelector('#palette-browse'), null);
  } finally { f.dispose(); }
});

test('session row options share indicators and muted timestamps without visible status text', async () => {
  const states: SidebarState[] = [{}, { inactive: true }, { busy: true }, { compacting: true }, { pending: true },
    { unread: true }, { inputCount: 1 }, { failed: true }, { starting: true }, { restarting: true },
    { closing: true }, { deleting: true }, { blocked: true }];
  const timestamp = Date.now() - 120_000;
  const f = fixture(async () => ({ items: states.map((state, index) => ({
    id: `session-${index}`, label: `Conversation ${index}`, sessionRow: { key: `session-${index}`, title: `Conversation ${index}`, harnessLabel: 'Pi', timestamp, status: sessionIndicator(state).state, open: false }, run() {},
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
      assert.ok(row.querySelector('.session-row-heading > .picker-enter-hint'), 'Enter hint aligns with the title, not the whole two-line row');
      assert.equal(row.querySelector(':scope > .picker-enter-hint'), null);
      assert.equal(row.querySelector('small > time')!.textContent, sessionTime(timestamp));
      assert.equal(row.querySelector('time')!.getAttribute('datetime'), new Date(timestamp).toISOString());
      assert.equal(row.getAttribute('aria-label'), `Conversation ${index} — ${status.label}`);
      assert.equal(row.getAttribute('aria-describedby'), `${row.querySelector('time')!.id} ${row.querySelector('.session-row-harness')!.id}`);
      assert.equal(row.querySelector('small')!.textContent, `${sessionTime(timestamp)} · Pi`);
      assert.ok(!row.textContent!.includes(status.label));
    }
    f.query('working');
    assert.equal(f.list().children.length, 1, 'status remains searchable without visible status text');
    assert.equal(f.list().firstElementChild!.getAttribute('aria-selected'), 'true');
  } finally { f.dispose(); }
});

test('every palette page shares one-step dismissal across entry points and cancellation paths', async () => {
  for (const page of ['commands', 'resume', 'switch', 'projects', 'selection', 'name']) {
    for (const entry of ['direct', 'palette']) {
      for (const cancellation of ['keyboard', 'native', 'api']) {
        const f = fixture();
        try {
          if (entry === 'palette') { f.palette.open(); f.query('remember me'); }
          let choice: Promise<string | undefined> | undefined;
          if (page === 'commands') { if (entry === 'direct') f.palette.open(); }
          else if (page === 'resume') await f.palette.sessions();
          else if (page === 'switch') await f.palette.openSessions();
          else if (page === 'projects') await f.palette.projects();
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

test('session membership is searchable without badges and rows share selected Enter hints', async () => {
  const chosen: string[] = [];
  const f = fixture(async () => ({ items: [
    { id: 'a', label: 'A very long title', sessionRow: { key: 'a', title: 'A very long title', harnessLabel: 'Pi', timestamp: 100, status: 'working', open: true }, keywords: 'A very long preview /sessions/a.jsonl', run: () => { chosen.push('a'); } },
    { id: 'b', label: 'Historical session', sessionRow: { key: 'b', title: 'Historical session', harnessLabel: 'Pi', status: 'closed', open: false }, run: () => { chosen.push('b'); } },
  ] }));
  try {
    await f.palette.sessions();
    assert.equal(f.list().querySelectorAll('.session-row').length, 2);
    assert.equal(f.list().querySelectorAll('.session-row-badge').length, 0);
    assert.equal(f.list().querySelectorAll('.picker-enter-hint').length, 2);
    assert.equal(f.list().querySelector('.picker-enter-hint')!.getAttribute('aria-hidden'), 'true');
    assert.equal(f.list().querySelector('.picker-enter-hint')!.getAttribute('focusable'), 'false');
    assert.equal(f.list().children[0].getAttribute('aria-selected'), 'true');
    f.key('ArrowDown');
    assert.equal(f.list().children[1].getAttribute('aria-selected'), 'true');
    assert.equal(f.list().children[1].querySelector('.session-indicator')!.textContent, '—');
    f.query('closed'); assert.equal(f.list().children.length, 1);
    f.query('');
    assert.equal(f.list().querySelector('small')!.textContent, `${sessionTime(100)} · Pi`);
    assert.equal(f.list().children[0].getAttribute('aria-label'), 'A very long title — Working — Open');
    assert.equal(f.list().children[1].querySelector('small')!.textContent, 'No message time · Pi');
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
    f.query('new session'); f.key('ArrowDown'); f.key('Enter', { isComposing: true }); await tick(); assert.deepEqual(f.calls, []);
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
    (f.list().children[1] as HTMLElement).click(); await tick();
    assert.deepEqual(f.calls, ['new']); assert.equal(f.dialog.open, false);
  } finally { f.dispose(); }
});


test('command MRU records acceptance only, keeps filtering and picker order independent', async () => {
  const usage: { id: string; lastUsedAt: number; useCount: number }[] = [];
  const accepted: string[] = [];
  const f = fixture(async () => ({ items: [] }), {
    usage: () => usage,
    record: id => { accepted.push(id); usage.unshift({ id, lastUsedAt: 1, useCount: 1 }); },
  });
  try {
    f.palette.open(); f.key('ArrowDown'); f.key('Escape'); await tick();
    assert.deepEqual(accepted, []);
    f.palette.open(); f.query('switch'); f.key('Enter'); await tick();
    assert.deepEqual(accepted, ['switch']);
    f.key('Escape'); await tick(); f.palette.open();
    assert.match(f.list().firstElementChild!.textContent!, /Switch session/);
    f.query('new session'); assert.equal(f.list().children.length, 2);
    f.key('ArrowDown');
    assert.match(f.list().querySelector('[aria-selected=true]')!.textContent!, /New session/);
    f.key('Enter'); f.key('Enter'); await tick();
    assert.deepEqual(accepted, ['switch', 'new']);
    await f.palette.openSessions(); f.key('Enter'); await tick();
    assert.deepEqual(accepted, ['switch', 'new'], 'picker choices are not commands');
    const request = f.palette.startSelection('Custom picker', () => {})!;
    const choice = request.choose(['Zulu', 'Alpha']);
    assert.equal(f.list().firstElementChild!.textContent, 'Zulu');
    f.key('Escape'); assert.equal(await choice, undefined);
  } finally { f.dispose(); }
});

test('ranking strategy is injectable and receives filtered commands, query and usage', () => {
  let invocations = 0;
  const f = fixture(undefined, {
    usage: () => [], record() {},
    strategy: { id: 'reverse', rank(commands, context) {
      invocations++; assert.deepEqual(context.usage, []);
      if (context.query) assert.ok(commands.every(c => c.label.includes('New')));
      return [...vscodeMruRanking.rank(commands, context)].reverse();
    } },
  });
  try {
    f.palette.open(); assert.match(f.list().firstElementChild!.textContent!, /Switch/);
    f.query('New'); assert.equal(f.list().children.length, 2);
    assert.match(f.list().firstElementChild!.textContent!, /New session/);
    assert.equal(invocations, 2);
  } finally { f.dispose(); }
});
