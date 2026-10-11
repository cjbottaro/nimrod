import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeDrafts, type NativeDraftRecord } from '../src/native-drafts';

test('native draft IPC is ordered, revisions resume, and flush waits for staging', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: unknown[] = [];
  const errors: unknown[] = [];
  const drafts = new NativeDrafts('/fixture', error => errors.push(error), {
    load: async () => [{ key: 'file:/a', revision: 7, value: { draft: 'restored' } }],
    stage: async (_project, record: NativeDraftRecord) => { calls.push(record); if (record.revision === 8) await gate; },
    flush: async () => { calls.push('flush'); },
  });
  assert.deepEqual(await drafts.load(), { 'file:/a': { draft: 'restored' } });
  drafts.change('file:/a', { draft: 'one' }); drafts.change('file:/a', { draft: 'two' });
  const flushing = drafts.flush();
  await Promise.resolve(); assert.equal(calls.length, 1);
  release(); await flushing;
  assert.deepEqual(calls, [{ key: 'file:/a', revision: 8, value: { draft: 'one' } }, { key: 'file:/a', revision: 9, value: { draft: 'two' } }, 'flush']);
  assert.deepEqual(errors, []);
});

test('staging failures are visible and prevent a pre-send flush', async () => {
  const errors: unknown[] = [];
  const drafts = new NativeDrafts('/fixture', error => errors.push(error), {
    load: async () => [], stage: async () => { throw new Error('disk unavailable'); }, flush: async () => {},
  });
  await drafts.load(); drafts.change('file:/a', { draft: 'retained' });
  await assert.rejects(drafts.flush(), /disk unavailable/);
  assert.equal(errors.length, 1);
});
