import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionDeletion, type DeleteResult, type DeletionEvent, type DeletionPanel, type DeletionSnapshot, type SessionDeletionReport } from '../src/session-deletion';

function fixture() {
  const calls: string[] = [], errors: string[] = [], acknowledgements: SessionDeletionReport[][] = [];
  let snapshot: DeletionSnapshot = { pending: false, quarantine: [], files: [] };
  let resolveRun!: () => void;
  let results: DeleteResult[] = [];
  const batches: string[][] = [];
  const panels = ['root', 'child', 'unrelated'].map(name => {
    const panel: DeletionPanel & { locked: boolean; executing: boolean; removed: boolean; busy: boolean; hasDraft: boolean } = {
      file: `/store/${name}.jsonl`, locked: false, executing: false, removed: false, busy: false, hasDraft: name === 'child',
      lock(locked) { this.locked = locked; if (!locked) this.executing = false; calls.push(`${name}:lock:${locked}`); },
      executionStarted() { this.executing = true; calls.push(`${name}:execution`); },
      report() { return { file: this.file, token: name, title: name, busy: this.busy, hasDraft: this.hasDraft }; },
      deleted() { this.removed = true; calls.push(`${name}:deleted`); },
      failed(message) { calls.push(`${name}:failed`); errors.push(message); },
    };
    return panel;
  });
  const controller = new SessionDeletion({
    panels: () => panels.filter(p => !p.removed),
    acknowledge: async (id, reports) => { calls.push(`ack:${id}`); acknowledgements.push(reports); },
    snapshot: async () => snapshot,
    run: async () => { calls.push('run'); await new Promise<void>(resolve => { resolveRun = resolve; }); return results; },
    recover: async (file) => { calls.push(`recover:${file}`); if (file.endsWith('missing.jsonl')) throw new Error('File unavailable'); },
    deleted: files => { batches.push(files); for (const panel of panels) if (files.includes(panel.file)) panel.deleted(); },
    review: async () => true,
    confirm: async (id, confirmed) => { calls.push(`confirm:${id}:${confirmed}`); },
    changed() {}, error: message => errors.push(message),
  });
  const event = (phase: DeletionEvent['phase'], overrides: Partial<DeletionEvent> = {}): DeletionEvent => ({ id: 'round', phase, files: panels.slice(0, 2).map(p => p.file), results: [], pending: !['release', 'complete'].includes(phase), ...overrides });
  return { controller, panels, calls, errors, acknowledgements, batches, event, finish: (value: DeleteResult[] = []) => { results = value; resolveRun(); }, snapshot: (value: DeletionSnapshot) => { snapshot = value; } };
}

test('loading review opens before IPC and closes on failure even if deletion state cannot be verified', async () => {
  const calls: string[] = [];
  const controller = new SessionDeletion({
    panels: () => [], acknowledge: async () => {}, recover: async () => {}, changed() {},
    loadingReview: () => { calls.push('loading'); }, cancelReview: () => { calls.push('close'); },
    run: async () => { calls.push('ipc'); throw new Error('Preview unavailable'); },
    snapshot: async () => { throw new Error('Deletion state unknown'); },
    error: message => { calls.push(message); },
  });
  const task = controller.run('/root', 'id');
  assert.deepEqual(calls, ['loading', 'ipc']);
  await task;
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.match(calls[2], /Preview unavailable/);
  assert.equal(controller.pending, true);
});

test('initiating review stays modal through completion events, IPC and snapshot reconciliation, including returned-only successes', async () => {
  const calls: string[] = [];
  let finish!: (results: DeleteResult[]) => void, invocations = 0;
  let readSnapshot!: (snapshot: DeletionSnapshot) => void, snapshotReady!: () => void;
  const snapshotStarted = new Promise<void>(resolve => { snapshotReady = resolve; });
  const controller = new SessionDeletion({
    panels: () => [], acknowledge: async () => {}, recover: async () => {}, changed() {},
    loadingReview: () => calls.push('loading'), cancelReview: () => calls.push('close'),
    progressReview: phase => calls.push(phase),
    deleted: files => calls.push(`deleted:${files.join(',')}`),
    run: () => { invocations++; return new Promise(resolve => { finish = resolve; }); },
    snapshot: () => new Promise(resolve => { readSnapshot = resolve; snapshotReady(); }),
    error: message => calls.push(message),
  });
  const task = controller.run('/root', 'id');
  const event = (phase: DeletionEvent['phase']): DeletionEvent => ({ id: phase, phase, files: ['/root'], results: [], pending: phase !== 'complete' });
  await controller.handle(event('quarantine')); await controller.handle(event('removing'));
  await controller.handle(event('complete'));
  assert.deepEqual(calls, ['loading', 'stopping', 'deleting']);
  finish([{ file: '/root', deleted: true }]);
  await snapshotStarted;
  await controller.run('/root', 'id'); assert.equal(invocations, 1, 'local settlement still suppresses duplicate deletion after native completion');
  assert.equal(calls.includes('close'), false);
  readSnapshot({ pending: false, quarantine: ['/root'], files: [] }); await task;
  assert.deepEqual(calls, ['loading', 'stopping', 'deleting', 'deleted:/root', 'close']);
});

test('returned successful results reconcile even when completion events are missing; duplicates do not remove twice', async () => {
  const f = fixture();
  const results = f.panels.slice(0, 2).map(panel => ({ file: panel.file, deleted: true }));
  const task = f.controller.run(f.panels[0].file, 'id');
  f.snapshot({ pending: false, quarantine: results.map(r => r.file), files: [] });
  f.finish(results); await task;
  assert.deepEqual(f.batches, [results.map(r => r.file)]);
  assert.equal(f.panels[2].removed, false);
  assert.equal(f.calls.some(call => call.includes(':failed')), false);
  await f.controller.handle(f.event('complete', { results }));
  assert.equal(f.batches.length, 1);
});

test('snapshot success tombstones remove stale entries before quarantine can report them as failed', () => {
  const f = fixture();
  f.controller.load({ pending: false, quarantine: [f.panels[0].file], files: [], deleted: [f.panels[0].file] });
  assert.equal(f.panels[0].removed, true); assert.equal(f.calls.some(call => call.includes(':failed')), false);
});

test('custom review acknowledgement is correlated to its request and executes no deletion by itself', async () => {
  const f = fixture();
  await f.controller.handle(f.event('review', { tree: [{ file: f.panels[0].file, title: 'Root' }] }));
  assert.deepEqual(f.calls, ['confirm:round:true']); assert.equal(f.panels[0].removed, false);
});

test('deletion locks affected sessions only and acknowledges ownership without waiting for Pi', async () => {
  const f = fixture();
  await f.controller.handle(f.event('lock'));
  assert.deepEqual(f.calls, ['root:lock:true', 'child:lock:true', 'ack:round']);
  assert.equal(f.panels[2].locked, false); assert.equal(f.controller.pending, true);
  assert.equal(f.acknowledgements[0][1].hasDraft, true);
  await f.controller.handle(f.event('release'));
  assert.equal(f.controller.pending, false); assert.equal(f.panels[0].locked, false);
  assert.equal(f.controller.blocked(f.panels[0].file), false);
  assert.equal(f.panels[0].removed, false);
});

test('pending deletion tracks affected files without guarding unrelated history or recovery', async () => {
  const f = fixture();
  await f.controller.handle(f.event('begin', { files: [] }));
  assert.equal(f.controller.locked(f.panels[0].file), false);
  await f.controller.handle(f.event('lock'));
  assert.equal(f.controller.locked(f.panels[0].file), true);
  assert.equal(f.controller.locked(f.panels[2].file), false);
  assert.equal(f.controller.blocked(f.panels[2].file), false);
  await f.controller.recover(f.panels[2].file, 'id');
  assert.equal(f.calls.includes(`recover:${f.panels[2].file}`), true);
  await assert.rejects(f.controller.recover(f.panels[0].file, 'id'), /locked/);
  await f.controller.handle(f.event('release'));
  assert.equal(f.controller.locked(f.panels[0].file), false);
});

test('invalid persisted deletion state guards saved paths but never pathless new sessions', () => {
  const f = fixture();
  f.controller.load({ pending: true, files: [], quarantine: [], error: 'Invalid persisted deletion state' });
  assert.equal(f.controller.blocked('/store/unknown.jsonl'), true);
  assert.equal(f.controller.blocked(undefined), false);
});

test('busy descendants remain in ownership reports and newly discovered descendants receive execution locks', async () => {
  const f = fixture(); f.panels[1].busy = true;
  await f.controller.handle(f.event('lock'));
  assert.equal(f.acknowledgements[0].length, 2); assert.equal(f.acknowledgements[0][1].busy, true);
  await f.controller.handle(f.event('check', { id: 'check', files: f.panels.map(panel => panel.file) }));
  assert.equal(f.acknowledgements[1].length, 3);
  await f.controller.handle(f.event('quarantine', { files: f.panels.map(panel => panel.file) }));
  assert.equal(f.panels[2].locked, true); assert.equal(f.panels[2].executing, true);
});

test('preview and confirmation lock affected panels without execution activity; quarantine starts execution only for affected files', async () => {
  const f = fixture();
  await f.controller.handle(f.event('lock'));
  await f.controller.handle(f.event('review', { tree: [{ file: f.panels[0].file, title: 'Root' }] }));
  await f.controller.handle(f.event('check'));
  assert.equal(f.panels[0].locked, true); assert.equal(f.panels.some(panel => panel.executing), false);
  await f.controller.handle(f.event('quarantine'));
  assert.equal(f.panels[0].executing, true); assert.equal(f.panels[1].executing, true); assert.equal(f.panels[2].executing, false);
  f.controller.load({ pending: false, quarantine: f.panels.slice(0, 2).map(panel => panel.file), files: [] });
  assert.equal(f.panels.some(panel => panel.executing || panel.locked), false);
});

test('known partial results remove only successful files and quarantine failed inactive sessions without replay', async () => {
  const f = fixture(); await f.controller.handle(f.event('lock')); await f.controller.handle(f.event('quarantine'));
  await f.controller.handle(f.event('complete', { results: [{ file: f.panels[0].file, deleted: true }, { file: f.panels[1].file, deleted: false, error: 'Permission denied' }] }));
  assert.equal(f.panels[0].removed, true); assert.equal(f.panels[1].removed, false); assert.equal(f.panels[2].removed, false);
  assert.equal(f.controller.blocked(f.panels[1].file), true); assert.equal(f.controller.pending, false);
  assert.match(f.errors[0], /Permission denied.*Resume session.*nothing will be replayed/);
  assert.equal(f.panels[1].locked, false);
});

test('unknown outcomes retain entries and keep only affected recovery guarded until release', async () => {
  const f = fixture(); await f.controller.handle(f.event('lock'));
  await f.controller.handle(f.event('complete', { message: 'Outcome unknown', pending: true }));
  assert.equal(f.controller.pending, true); assert.equal(f.panels.some(p => p.removed), false);
  await assert.rejects(f.controller.recover(f.panels[0].file, 'id'), /locked/);
  await f.controller.handle(f.event('release'));
  await f.controller.recover(f.panels[0].file, 'id');
  assert.equal(f.controller.blocked(f.panels[0].file), false); assert.equal(f.controller.blocked(f.panels[1].file), true);
  f.controller.load({ pending: false, quarantine: ['/store/missing.jsonl'], files: [] });
  await assert.rejects(f.controller.recover('/store/missing.jsonl', 'id'), /unavailable/);
  assert.equal(f.controller.blocked('/store/missing.jsonl'), true);
});

test('quarantine survives a frontend restore and events cannot mutate panels after disposal', async () => {
  const f = fixture(); f.controller.load({ pending: false, quarantine: [f.panels[0].file], files: [] });
  assert.equal(f.controller.blocked(f.panels[0].file), true);
  f.controller.dispose(); await f.controller.handle(f.event('complete', { results: [{ file: f.panels[0].file, deleted: true }] }));
  assert.equal(f.panels[0].removed, false);
});

test('duplicate delete requests are suppressed and native state is authoritative after command completion', async () => {
  const f = fixture(); const first = f.controller.run(f.panels[0].file, 'id');
  await f.controller.run(f.panels[0].file, 'id'); assert.deepEqual(f.calls, ['run']);
  f.snapshot({ pending: true, quarantine: [f.panels[0].file], files: [f.panels[0].file] });
  f.finish(); await first;
  assert.equal(f.controller.pending, true); assert.equal(f.controller.blocked(f.panels[0].file), true);
});
