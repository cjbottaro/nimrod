import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { CopilotFolderTrust } from '../src/copilot/folder-trust';
import { CopilotSession } from '../src/copilot/session';
import type { BridgeRequest } from '../src/copilot/connection';
import { installCommandPalette } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window, document = win.document; stubDialogs(win);
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!;
  const input = document.querySelector<HTMLInputElement>('#palette-input')!;
  const draft = document.createElement('textarea'); draft.value = 'keep this draft'; document.body.append(draft); draft.focus();
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }),
  });
  let selected = true, bannerCount = 0, pending = 0, review = () => {};
  const trust = new CopilotFolderTrust('/fixture/project', {
    document, canPresent: () => selected && !document.querySelector('dialog[open]:not(#command-palette)'),
    start: dismiss => palette.startRetainedSelection('Copilot folder trust', dismiss),
    input: async () => { assert.fail('folder trust never accepts freeform'); }, cancelInput() {},
    changed: delta => { pending += delta; }, banner: (count, action) => { bannerCount = count; review = action; }, error: assert.fail,
  });
  return { document, dialog, input, draft, trust,
    counts: () => ({ bannerCount, pending }), review: () => review(),
    select(value: boolean) { selected = value; trust.setActive(value); },
    dismiss(native: boolean) {
      if (native) dialog.dispatchEvent(new win.Event('cancel', { cancelable: true }));
      else input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    },
    click(label: string) {
      const row = [...document.querySelectorAll<HTMLElement>('#palette-list > [role=option]')].find(row => row.textContent?.includes(label));
      assert.ok(row, label); row.click();
    },
    dispose() { trust.dispose(); palette.dispose(); win.close(); },
  };
}

for (const native of [false, true]) test(`Copilot folder trust ${native ? 'native dismissal' : 'Escape'} retains consent, banner and draft`, async () => {
  const f = fixture(), owner = new AbortController();
  try {
    let answered = false;
    const choice = f.trust.request(owner.signal); void choice.then(() => { answered = true; });
    assert.equal(f.dialog.open, true);
    assert.match(f.document.querySelector('#palette-context')!.textContent!, /\/fixture\/project/);
    assert.match(f.document.querySelector('#palette-context')!.textContent!, /CLI/);
    assert.doesNotMatch(f.document.querySelector('#palette-list')!.textContent!, /Enter your own answer|session only/);
    f.dismiss(native); await flush();
    assert.equal(f.dialog.open, false); assert.equal(answered, false);
    assert.deepEqual(f.counts(), { pending: 1, bannerCount: 1 });
    f.select(false); f.select(true); assert.equal(f.dialog.open, false);
    f.review(); assert.equal(f.dialog.open, true); assert.equal(answered, false);
    f.click('Trust for this and future sessions'); assert.equal(await choice, true);
    assert.deepEqual(f.counts(), { pending: 0, bannerCount: 0 });
    assert.equal(f.draft.value, 'keep this draft');
  } finally { owner.abort(); f.dispose(); }
});

test('Copilot folder trust stays background-local and distinguishes no grant from owner cancellation', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    f.select(false);
    const choice = f.trust.request(owner.signal);
    assert.equal(f.dialog.open, false); assert.equal(f.counts().bannerCount, 1);
    f.select(true); assert.equal(f.dialog.open, true);
    f.click('Continue without trust'); assert.equal(await choice, false);
    const stale = f.trust.request(owner.signal);
    const row = f.document.querySelector<HTMLElement>('#palette-list > [role=option]')!;
    owner.abort(); assert.equal(await stale, undefined);
    row.click(); assert.deepEqual(f.counts(), { pending: 0, bannerCount: 0 });
    assert.equal(f.dialog.open, false); assert.equal(f.draft.value, 'keep this draft');
  } finally { owner.abort(); f.dispose(); }
});

for (const interrupted of [false, true]) test(`Copilot startup waits outside RPC timeout and rejects stale trust consent (${interrupted})`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: BridgeRequest[] = [];
  let answer!: (value: boolean) => void, signal: AbortSignal | undefined;
  const session = new CopilotSession(async message => { sent.push(message); }, {
    publish() {}, changed() {}, identified() {}, disconnected() {}, completed() {}, notice() {}, decision: async () => undefined,
    trustFolder: owner => { signal = owner; return new Promise(resolve => { answer = resolve; }); },
  });
  const reply = (result: unknown) => session.receive({ kind: 'result', id: sent.at(-1)!.id, result });
  const starting = session.initialize('exact-saved-id');
  try {
    reply({ version: '1.0.113' }); await flush();
    assert.equal(sent.at(-1)!.sessionId, 'exact-saved-id');
    reply({ trustRequired: true }); await flush();
    assert.equal(session.state.status, 'Waiting for folder trust…');
    assert.equal(session.canSubmit, false);
    context.mock.timers.tick(60_000); await flush();
    assert.equal(signal?.aborted, false, 'no outstanding RPC times out while the picker is pending');
    assert.deepEqual(sent.map(message => message.method), ['initialize', 'connect']);
    if (interrupted) session.disconnect('owner closed');
    answer(true); await flush();
    if (interrupted) {
      await assert.rejects(starting, /interrupted/);
      assert.equal(signal?.aborted, true);
      assert.equal(sent.some(message => message.method === 'folder-trust'), false);
    } else {
      assert.equal(sent.at(-1)!.method, 'folder-trust'); assert.equal(sent.at(-1)!.trust, true);
      session.receive({ kind: 'connected', sessionId: 'exact-saved-id', events: [], models: [], model: { modelId: 'fixture' } });
      // Connected may start optional metadata reads; reply to the trust request explicitly.
      session.receive({ kind: 'result', id: sent.find(message => message.method === 'folder-trust')!.id, result: null });
      await starting; assert.equal(session.state.sessionUnavailable, false);
    }
    assert.equal(sent.some(message => message.method === 'prompt' || message.method === 'command'), false);
  } finally { session.disconnect('done'); context.mock.timers.reset(); }
});
