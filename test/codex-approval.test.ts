import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CodexApprovalInteraction } from '../src/codex/approval-interaction';
import type { PalettePage } from '../src/command-palette';
import type { CodexApproval } from '../src/codex/protocol';
const request = (itemId = 'item'): CodexApproval => ({ kind: 'command', threadId: 'thread', turnId: 'turn', itemId, native: { command: 'echo fixture', cwd: '/fixture' } });
function fixture() {
  const document = new JSDOM('<body></body>').window.document;
  let page: PalettePage | undefined, dismissed: (() => void) | undefined, current = false, active = true, count = 0, inputs = 0, shown = 0;
  const interaction = new CodexApprovalInteraction({
    document, canPresent: () => active,
    start: dismiss => { dismissed = dismiss; current = true; return {
      show: next => { page = next; shown++; }, remaining() {}, focus() {}, isCurrent: () => current,
      cancel: () => { current = false; dismiss(); },
    }; },
    changed: delta => { inputs += delta; }, banner: pending => { count = pending; },
  });
  return { interaction, page: () => page, count: () => count, inputs: () => inputs, shown: () => shown,
    dismiss: () => { current = false; dismissed?.(); }, active: (value: boolean) => { active = value; interaction.setActive(value); } };
}

test('Codex approval Escape/navigation do not settle requests; explicit review reopens', async () => {
  const f = fixture(), signal = new AbortController(); let settled = false;
  const pending = f.interaction.request(request(), signal.signal).then(value => { settled = true; return value; });
  assert.equal(f.count(), 1); f.dismiss(); await Promise.resolve(); assert.equal(settled, false);
  const shown = f.shown(); f.active(false); f.active(true); assert.equal(f.shown(), shown);
  f.interaction.review(); assert.equal(f.shown(), shown + 1);
  await f.page()!.items.find(item => item.id === 'accept')!.run();
  assert.equal(await pending, 'accept'); assert.equal(f.count(), 0); assert.equal(f.inputs(), 0); f.interaction.dispose();
});

test('Codex approvals are FIFO and arrivals retain the active page', async () => {
  const f = fixture(), first = new AbortController(), second = new AbortController();
  const a = f.interaction.request(request('a'), first.signal); const shown = f.shown();
  const b = f.interaction.request(request('b'), second.signal);
  assert.equal(f.shown(), shown); assert.equal(f.count(), 2);
  await f.page()!.items.find(item => item.id === 'decline')!.run(); assert.equal(await a, 'decline');
  assert.equal(f.shown(), shown + 1); second.abort(); assert.equal(await b, 'cancel');
  assert.equal(f.count(), 0); f.interaction.dispose();
});

test('Codex background approvals never open a modal; stale choices cannot answer a retired request', async () => {
  const f = fixture(); f.active(false); const abort = new AbortController();
  const pending = f.interaction.request(request(), abort.signal); assert.equal(f.shown(), 0); assert.equal(f.count(), 1);
  f.active(true); const stale = f.page()!.items[0]; abort.abort(); assert.equal(await pending, 'cancel');
  await stale.run(); assert.equal(f.count(), 0); f.interaction.dispose();
});
