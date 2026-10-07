import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { notificationPreview, sessionNotifications, type AttentionKind, type NotificationTarget } from '../src/notifications';

test('response previews remove Markdown chrome, HTML and remote media and preserve literal code', () => {
  const dom = new JSDOM('');
  try {
    const preview = notificationPreview(dom.window as unknown as Window);
    assert.equal(preview('**Done.**\n\nTests passed. [Details](https://example.com/private)\n\n`a < b && c`'), 'Done. Tests passed. Details a < b && c');
    assert.equal(preview('<script>secret()</script><img src="https://example.com/track"><b>Visible</b>'), 'Visible');
    assert.equal(preview('First  \nsecond\n\nthird'), 'First second third');
    assert.equal(preview(undefined), undefined);
    assert.equal(preview(' \n '), undefined);
    assert.equal(preview('\0\u202e'), undefined);
  } finally { dom.window.close(); }
});

test('preview conversion failure falls back without disrupting session event delivery', () => {
  const dom = new JSDOM('');
  try {
    const preview = notificationPreview(dom.window as unknown as Window);
    dom.window.document.createElement = () => { throw new Error('fixture conversion failure'); };
    assert.equal(preview('Done'), undefined);
  } finally { dom.window.close(); }
});

test('response previews are Unicode-safe and bounded for native delivery', () => {
  const dom = new JSDOM('');
  try {
    const preview = notificationPreview(dom.window as unknown as Window);
    const text = preview('🙂'.repeat(1200))!;
    assert.equal(Array.from(text).length, 1000);
    assert.equal(text, `${'🙂'.repeat(999)}…`);
  } finally { dom.window.close(); }
});

function fixture() {
  let focused = true, selected = true, valid = true, enabled = true;
  const sent: AttentionKind[] = [], errors: string[] = [];
  const target: NotificationTarget = { session: 'Session', selected: () => selected, valid: () => valid };
  const notify = sessionNotifications({ focused: async () => focused, send: async kind => { sent.push(kind); } }, () => enabled, error => errors.push(error));
  return { notify, target, sent, errors,
    focused(value: boolean) { focused = value; }, selected(value: boolean) { selected = value; }, valid(value: boolean) { valid = value; }, enabled(value: boolean) { enabled = value; } };
}

test('selected foreground session stays quiet; background sessions and unfocused windows notify', async () => {
  const f = fixture();
  await f.notify('completed', f.target); assert.deepEqual(f.sent, []);
  f.selected(false); await f.notify('completed', f.target);
  f.selected(true); f.focused(false); await f.notify('input', f.target);
  assert.deepEqual(f.sent, ['completed', 'input']);
});

test('disabled and retired sessions produce no alerts or delayed replay', async () => {
  const f = fixture(); f.focused(false);
  f.enabled(false); await f.notify('failed', f.target);
  f.enabled(true); f.valid(false); await f.notify('input', f.target);
  assert.deepEqual(f.sent, []);
});

test('rechecks selection, lifecycle and preferences after native focus lookup', async () => {
  for (const change of ['selection', 'lifecycle', 'preferences']) {
    let resolve!: (value: boolean) => void;
    let selected = false, valid = true, enabled = true;
    const sent: string[] = [];
    const target = { session: 'Session', selected: () => selected, valid: () => valid };
    const notify = sessionNotifications({ focused: () => new Promise(r => { resolve = r; }), send: async () => { sent.push('sent'); } }, () => enabled, () => {});
    const pending = notify('completed', target);
    if (change === 'selection') selected = true;
    if (change === 'lifecycle') valid = false;
    if (change === 'preferences') enabled = false;
    resolve(true); await pending;
    assert.deepEqual(sent, [], change);
  }
});

test('permission preparation rechecks selection, focus, lifecycle and preferences before sending', async () => {
  for (const change of ['selection', 'focus', 'lifecycle', 'preferences']) {
    let release!: () => void;
    let focused = change !== 'focus', selected = change === 'focus', valid = true, enabled = true;
    const sent: string[] = [];
    const target = { session: 'Session', selected: () => selected, valid: () => valid };
    const notify = sessionNotifications({ focused: async () => focused, prepare: () => new Promise<void>(resolve => { release = resolve; }), send: async () => { sent.push('sent'); } }, () => enabled, () => {});
    const pending = notify('completed', target); await Promise.resolve();
    if (change === 'selection') selected = true;
    if (change === 'focus') focused = true;
    if (change === 'lifecycle') valid = false;
    if (change === 'preferences') enabled = false;
    release(); await pending;
    assert.deepEqual(sent, [], change);
  }
});

test('authorization failures are reported and native suppression is not claimed as submission', async () => {
  const errors: string[] = [], status: string[] = [], sent: string[] = [];
  const target = { session: 'Session', selected: () => false, valid: () => true };
  const failed = sessionNotifications({ focused: async () => true, prepare: async () => { throw new Error('fixture authorization denied'); }, send: async () => { sent.push('sent'); } }, () => true, error => errors.push(error), message => status.push(message));
  await failed('completed', target);
  assert.deepEqual(sent, []); assert.match(errors[0], /authorization denied/);
  const suppressed = sessionNotifications({ focused: async () => true, send: async () => 'suppressed' }, () => true, () => {}, message => status.push(message));
  await suppressed('completed', target);
  assert.match(status.at(-1)!, /suppressed at the native/);
  assert.ok(!status.some(message => message.includes('submitted to the OS')));
});

test('native failure is reported without rejecting or changing session state', async () => {
  const errors: string[] = [];
  const notify = sessionNotifications({ focused: async () => false, send: async () => { throw new Error('unavailable'); } }, () => true, error => errors.push(error));
  await notify('completed', { session: 'Session', selected: () => false, valid: () => true });
  assert.match(errors[0], /unavailable/);
});
