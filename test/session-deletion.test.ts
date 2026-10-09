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
    const panel: DeletionPanel & { locked: boolean; removed: boolean; busy: boolean; hasDraft: boolean; failing: boolean } = {
      file: `/store/${name}.jsonl`, locked: false, removed: false, busy: false, hasDraft: name === 'child', failing: false,
      lock(locked) { this.locked = locked; calls.push(`${name}:lock:${locked}`); },
      async refresh() { calls.push(`${name}:refresh`); if (this.failing) throw new Error('Unresponsive session'); },
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

test('deletion locks affected sessions only, refreshes idle state and includes recoverable draft disclosure', async () => {
  const f = fixture();
  await f.controller.handle(f.event('lock'));
  assert.deepEqual(f.calls, ['root:lock:true', 'child:lock:true', 'root:refresh', 'child:refresh', 'ack:round']);
  assert.equal(f.panels[2].locked, false); assert.equal(f.controller.pending, true);
  assert.equal(f.acknowledgements[0][1].hasDraft, true);
  await f.controller.handle(f.event('release'));
  assert.equal(f.controller.pending, false); assert.equal(f.panels[0].locked, false);
  assert.equal(f.controller.blocked(f.panels[0].file), false);
  assert.equal(f.panels[0].removed, false);
});

test('busy or unresponsive descendants report busy and cannot silently disappear from the acknowledgement', async () => {
  const f = fixture(); f.panels[1].failing = true;
  await f.controller.handle(f.event('lock'));
  assert.equal(f.acknowledgements[0].length, 2); assert.equal(f.acknowledgements[0][1].busy, true);
  f.panels[1].failing = false; f.panels[1].busy = true;
  await f.controller.handle(f.event('check', { id: 'check' }));
  assert.equal(f.acknowledgements[1][1].busy, true);
});

test('known partial results remove only successful files and quarantine failed inactive sessions without replay', async () => {
  const f = fixture(); await f.controller.handle(f.event('lock')); await f.controller.handle(f.event('quarantine'));
  await f.controller.handle(f.event('complete', { results: [{ file: f.panels[0].file, deleted: true }, { file: f.panels[1].file, deleted: false, error: 'Permission denied' }] }));
  assert.equal(f.panels[0].removed, true); assert.equal(f.panels[1].removed, false); assert.equal(f.panels[2].removed, false);
  assert.equal(f.controller.blocked(f.panels[1].file), true); assert.equal(f.controller.pending, false);
  assert.match(f.errors[0], /Permission denied.*Resume session.*nothing will be replayed/);
  assert.equal(f.panels[1].locked, false);
});

test('unknown outcomes retain all entries and require explicit recovery; pending deletion keeps launches blocked', async () => {
  const f = fixture(); await f.controller.handle(f.event('lock'));
  await f.controller.handle(f.event('complete', { message: 'Outcome unknown', pending: true }));
  assert.equal(f.controller.pending, true); assert.equal(f.panels.some(p => p.removed), false);
  await assert.rejects(f.controller.recover(f.panels[0].file, 'id'), /pending/);
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
