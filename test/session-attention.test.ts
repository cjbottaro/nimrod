import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionAttention, type AttentionEntry } from '../src/session-attention';

const entries = (needed: string[], open = ['a', 'b', 'c']): AttentionEntry[] => open.map(id => ({ id, needsAttention: needed.includes(id) }));

test('attention follows arrival order, not open order or later activity', () => {
  const inbox = new SessionAttention();
  assert.deepEqual(inbox.reconcile(entries([])), []);
  assert.deepEqual(inbox.reconcile(entries(['b'])), ['b']);
  assert.deepEqual(inbox.reconcile(entries(['a', 'b'])), ['b', 'a']);
  assert.deepEqual(inbox.reconcile(entries(['a', 'b', 'c'])), ['b', 'a', 'c']);
  assert.deepEqual(inbox.reconcile(entries(['a', 'b', 'c'])), ['b', 'a', 'c']);
});

test('selected resolved entry remains until leaving; unresolved attention does not clear on selection', () => {
  const inbox = new SessionAttention();
  inbox.reconcile(entries(['b', 'c']));
  assert.deepEqual(inbox.reconcile(entries(['c']), 'b'), ['b', 'c']);
  assert.deepEqual(inbox.reconcile(entries(['c']), 'b'), ['b', 'c']);
  assert.deepEqual(inbox.reconcile(entries(['c']), 'c'), ['c']);
  assert.deepEqual(inbox.reconcile(entries(['b', 'c']), 'c'), ['c', 'b']);
  assert.deepEqual(inbox.reconcile(entries([]), 'a'), []);
});

test('close removes selected entries; new arrivals never displace retained entries', () => {
  const inbox = new SessionAttention();
  inbox.reconcile(entries(['c']));
  inbox.reconcile(entries([]), 'c');
  assert.deepEqual(inbox.reconcile(entries(['a']), 'c'), ['c', 'a']);
  assert.deepEqual(inbox.reconcile(entries(['a'], ['a', 'b']), 'c'), ['a']);
});

test('returned order is a copy, not mutable controller state', () => {
  const inbox = new SessionAttention();
  const result = inbox.reconcile(entries(['b'])); result.push('c');
  assert.deepEqual(inbox.reconcile(entries(['b'])), ['b']);
});
