import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotSessionDeletion, type CopilotDeletionHistory } from '../src/acp/session-deletion';
import { piSessionDeletion } from '../src/pi/session-deletion';
import { SessionDeletion } from '../src/session-deletion';
import { savedSessionKey } from '../src/session-list';

const reference = { kind: 'acp' as const, profile: 'copilot' as const, sessionId: 'saved' };
function fixture() {
  const events: string[] = [];
  let confirm = true;
  let failStop = false;
  let failDelete = false;
  const history: CopilotDeletionHistory = {
    supportsDeletion: true,
    async validateDeletion(id) { events.push(`validate:${id}`); },
    async deleteSession(id) { events.push(`delete:${id}`); if (failDelete) throw new Error('Outcome unknown'); },
  };
  const source = new CopilotSessionDeletion({
    history: () => history,
    participants: () => [{
      lock: (locked, executing) => events.push(`lock:${locked}:${executing}`),
      async stop() { events.push('stop'); if (failStop) throw new Error('Child did not exit'); },
    }],
    async review(id, title) { events.push(`review:${id}:${title}`); return confirm; },
    progress: () => events.push('progress'),
    closeReview: () => events.push('close'),
    deleted: id => events.push(`reconcile:${id}`),
    changed: () => {},
  });
  return { source, history, events, cancel() { confirm = false; }, failStop() { failStop = true; }, failDelete() { failDelete = true; } };
}

test('Copilot deletion locks review, stops owned writers and reconciles only confirmed success', async () => {
  const f = fixture();
  const operation = f.source.operation(reference, 'Saved title')!;
  assert.equal(operation.label, 'Delete session…');
  assert.equal(operation.available(), true);
  await operation.run();
  assert.deepEqual(f.events, ['lock:true:false', 'review:saved:Saved title', 'validate:saved',
    'lock:true:true', 'stop', 'progress', 'delete:saved', 'reconcile:saved', 'lock:false:false', 'close']);
  assert.equal(f.source.removed(savedSessionKey(reference)), true);
  assert.equal(operation.available(), false);
  assert.equal(f.source.pending, false);
});

test('canceling deletion does not stop work, dispatch deletion or remove history', async () => {
  const f = fixture(); f.cancel();
  await f.source.operation(reference, 'Saved')!.run();
  assert.deepEqual(f.events, ['lock:true:false', 'review:saved:Saved', 'lock:false:false', 'close']);
  assert.equal(f.source.removed(savedSessionKey(reference)), false);
});

test('failed stop and unknown removal retain saved state without automatic retry', async () => {
  for (const failure of ['stop', 'delete']) {
    const f = fixture();
    if (failure === 'stop') f.failStop(); else f.failDelete();
    await assert.rejects(f.source.operation(reference, 'Saved')!.run());
    assert.equal(f.source.removed(savedSessionKey(reference)), false);
    assert.equal(f.events.some(event => event.startsWith('reconcile:')), false);
    assert.equal(f.events.filter(event => event === 'delete:saved').length, failure === 'stop' ? 0 : 1);
    assert.deepEqual(f.events.slice(-2), ['lock:false:false', 'close']);
    assert.equal(f.source.pending, false);
  }
});

test('unsupported deletion is absent, execution revalidates capabilities and disposal cancels review', async () => {
  const f = fixture();
  assert.equal(f.source.operation({ path: '/pi', sessionId: 'saved' }, 'Pi'), undefined);
  const operation = f.source.operation(reference, 'Saved')!;
  Object.assign(f.history, { supportsDeletion: false });
  assert.equal(f.source.operation(reference, 'Saved'), undefined);
  await assert.rejects(operation.run(), /unavailable/);
  Object.assign(f.history, { supportsDeletion: true });
  f.source.dispose();
  await assert.rejects(operation.run(), /unavailable/);
  assert.equal(f.events.includes('stop'), false);
});

test('Pi operation preserves the native tree transaction and refuses ACP identities', async () => {
  const calls: string[] = [];
  const deletion = new SessionDeletion({
    panels: () => [], acknowledge: async () => {}, snapshot: async () => ({ pending: false, files: [], quarantine: [] }),
    run: async (file, id) => { calls.push(`${file}:${id}`); return [{ file, deleted: true }]; },
    recover: async () => {}, changed: () => {}, error: message => { throw new Error(message); },
  });

  const source = piSessionDeletion(deletion);
  assert.equal(source.operation(reference, 'Copilot'), undefined);
  const operation = source.operation({ path: '/pi', sessionId: 'saved' }, 'Pi')!;
  assert.equal(operation.label, 'Delete session tree…');
  await operation.run();
  assert.deepEqual(calls, ['/pi:saved']);
  assert.equal(operation.available(), false);
});

test('concurrent deletion is refused and project disposal prevents dispatch after late validation', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.history.validateDeletion = async () => gate;
  const operation = f.source.operation(reference, 'Saved')!;
  const running = operation.run();
  await assert.rejects(operation.run(), /unavailable/);
  f.source.dispose();
  release(); await running;
  assert.equal(f.events.includes('stop'), false);
  assert.equal(f.events.includes('delete:saved'), false);
  assert.equal(f.source.pending, false);
});
