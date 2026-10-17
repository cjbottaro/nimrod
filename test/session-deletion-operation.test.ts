import assert from 'node:assert/strict';
import test from 'node:test';
import { copilotSessionDeletion, type CopilotDeletionHistory } from '../src/acp/session-deletion';
import { piSessionDeletion } from '../src/pi/session-deletion';
import { SessionDeletionCoordinator } from '../src/session-deletion-coordinator';
import type { SessionDeletionContext, SessionDeletionSource } from '../src/session-deletion-operation';
import { savedSessionKey } from '../src/session-list';

const reference = { kind: 'acp' as const, profile: 'copilot' as const, sessionId: 'saved' };
function fixture(extraStop?: () => Promise<void>) {
  const events: string[] = [], errors: string[] = [];
  let confirm = true, failStop = false, failDelete = false, ready = true;
  const history: CopilotDeletionHistory = {
    supportsDeletion: true,
    async validateDeletion(id) { events.push(`validate:${id}`); },
    async deleteSession(id) { events.push(`delete:${id}`); if (failDelete) throw new Error('Outcome unknown'); },
  };
  const coordinator = new SessionDeletionCoordinator({
    canRun: () => ready,
    participants: () => [{
      lock: (locked, executing) => events.push(`lock:${locked}:${executing}`),
      async stop() { events.push('stop'); if (failStop) throw new Error('Child did not exit'); },
    }, ...(extraStop ? [{ lock: () => {}, stop: extraStop }] : [])],
    review: {
      loadingReview: () => events.push('loading'),
      async review(data) { events.push(`review:${data.id}:${data.sessions[0].title}`); return confirm; },
      progress: () => events.push('progress'),
      closeReview: () => events.push('close'),
    },
    deleted: targets => events.push(`reconcile:${targets.map(target => target.key).join(',')}`),
    changed: () => {},
    error: message => errors.push(message),
  });
  coordinator.register(context => copilotSessionDeletion(() => history, context));
  return {
    coordinator, history, events, errors,
    cancel() { confirm = false; }, failStop() { failStop = true; }, failDelete() { failDelete = true; },
    ready(value: boolean) { ready = value; },
  };
}

test('Copilot uses shared review, participant shutdown and confirmed-only reconciliation', async () => {
  const f = fixture(), key = savedSessionKey(reference);
  const operation = f.coordinator.operation(reference, 'Saved title')!;
  assert.equal(operation.label, 'Delete session…');
  assert.equal(operation.available(), true);
  await operation.run();
  assert.deepEqual(f.events, ['lock:true:false', 'review:saved:Saved title', 'validate:saved',
    'lock:true:true', 'stop', 'progress', 'delete:saved', `reconcile:${key}`, 'lock:false:false', 'close']);
  assert.equal(f.coordinator.removed(key), true);
  assert.equal(operation.available(), false);
  assert.equal(f.coordinator.pending, false);
});

test('canceling deletion does not stop work, dispatch deletion or remove history', async () => {
  const f = fixture(); f.cancel();
  await f.coordinator.operation(reference, 'Saved')!.run();
  assert.deepEqual(f.events, ['lock:true:false', 'review:saved:Saved', 'lock:false:false', 'close']);
  assert.equal(f.coordinator.removed(savedSessionKey(reference)), false);
});

test('a target-bound operation cannot be redirected by later caller identity mutations', async () => {
  const f = fixture(), saved = { ...reference };
  const operation = f.coordinator.operation(saved, 'Saved')!;
  saved.sessionId = 'replacement';
  await operation.run();
  assert.equal(f.events.includes('delete:saved'), true);
  assert.equal(f.events.includes('delete:replacement'), false);
  assert.equal(f.coordinator.removed(savedSessionKey(reference)), true);
});

test('failed stop and unknown removal retain saved state and report once without retry', async () => {
  for (const failure of ['stop', 'delete']) {
    const f = fixture();
    if (failure === 'stop') f.failStop(); else f.failDelete();
    await f.coordinator.operation(reference, 'Saved')!.run();
    assert.equal(f.coordinator.removed(savedSessionKey(reference)), false);
    assert.equal(f.events.some(event => event.startsWith('reconcile:')), false);
    assert.equal(f.events.filter(event => event === 'delete:saved').length, failure === 'stop' ? 0 : 1);
    assert.deepEqual(f.events.slice(-2), ['lock:false:false', 'close']);
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0], failure === 'stop' ? /Child did not exit/ : /Outcome unknown/);
    assert.equal(f.coordinator.pending, false);
  }
});

test('a failed stop does not release locks while another owned stop is unsettled', async () => {
  let release!: () => void, started!: () => void;
  const stopping = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => { started(); await gate; });
  f.failStop();
  const running = f.coordinator.operation(reference, 'Saved')!.run();
  await stopping;
  assert.equal(f.coordinator.pending, true);
  assert.equal(f.events.includes('lock:false:false'), false);
  release(); await running;
  assert.equal(f.coordinator.pending, false);
  assert.equal(f.events.includes('delete:saved'), false);
  assert.equal(f.errors.length, 1);
});

test('unsupported operations explain missing capability, revalidate live support and refuse disposed execution', async () => {
  const f = fixture();
  const operation = f.coordinator.operation(reference, 'Saved')!;
  Object.assign(f.history, { supportsDeletion: false });
  assert.equal(operation.supported, false);
  assert.match(operation.unavailableReason!, /has not advertised/);
  assert.equal(operation.available(), false);
  await operation.run();
  assert.equal(f.events.includes('stop'), false);
  assert.equal(f.errors.length, 1);
  Object.assign(f.history, { supportsDeletion: true });
  assert.equal(operation.available(), true);
  f.coordinator.dispose();
  await operation.run();
  assert.equal(f.events.includes('stop'), false);
  assert.equal(f.events.includes('delete:saved'), false);
});

test('Pi operation preserves native IPC, snapshot tombstones and external-event deduplication', async () => {
  const f = fixture(), calls: string[] = [];
  const source = f.coordinator.register(context => piSessionDeletion({
    panels: () => [], acknowledge: async () => {}, snapshot: async () => ({ pending: false, files: [], quarantine: [] }),
    run: async (file, id) => { calls.push(`${file}:${id}`); return [{ file, deleted: true }]; },
    recover: async () => {}, confirm: async () => {},
  }, context));
  assert.equal(source.operation(reference, 'Copilot'), undefined);
  const operation = f.coordinator.operation({ path: '/pi', sessionId: 'saved' }, 'Pi')!;
  assert.equal(operation.label, 'Delete session tree…');
  await operation.run();
  assert.deepEqual(calls, ['/pi:saved']);
  assert.equal(operation.available(), false);
  assert.equal(f.coordinator.removed('/pi'), true);
  await source.transaction.handle({
    id: 'round', phase: 'complete', files: ['/pi'], results: [{ file: '/pi', deleted: true }], pending: false,
  });
  assert.equal(f.events.filter(event => event === 'reconcile:/pi').length, 1);
  await source.transaction.recover('/pi', 'saved');
  assert.equal(f.coordinator.removed('/pi'), false);
});

test('concurrent deletion is refused and disposal prevents dispatch after late validation', async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const validationStarted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.history.validateDeletion = async () => { started(); await gate; };
  const operation = f.coordinator.operation(reference, 'Saved')!;
  const running = operation.run();
  await validationStarted;
  assert.equal(f.coordinator.pending, true);
  await operation.run();
  assert.match(f.errors[0], /unavailable/);
  f.coordinator.dispose();
  release(); await running;
  assert.equal(f.events.includes('stop'), false);
  assert.equal(f.events.includes('delete:saved'), false);
  assert.equal(f.coordinator.pending, false);
});

test('disposal after dispatch ignores late success without replay or local cleanup', async () => {
  const f = fixture();
  let release!: () => void, started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.history.deleteSession = async () => { f.events.push('delete:saved'); started(); await gate; };
  const running = f.coordinator.operation(reference, 'Saved')!.run();
  await dispatched;
  f.coordinator.dispose();
  release(); await running;
  assert.equal(f.events.filter(event => event === 'delete:saved').length, 1);
  assert.equal(f.events.some(event => event.startsWith('reconcile:')), false);
  assert.equal(f.coordinator.removed(savedSessionKey(reference)), false);
  assert.equal(f.coordinator.pending, false);
});

test('a third source needs only registration: common operations, pending, cleanup and errors do not branch on harness', async () => {
  const f = fixture();
  const target = { key: 'fixture:saved', draftScope: 'file:/fixture/saved' };
  const saved = { path: '/fixture/saved', sessionId: 'fixture' };
  let effect!: SessionDeletionContext;
  let externalPending = false;
  const source: SessionDeletionSource = f.coordinator.register(context => {
    effect = context;
    return {
      get pending() { return externalPending; },
      operation(identity, title) {
        if (!('path' in identity) || identity.path !== saved.path) return;
        return {
          target, label: 'Delete fixture…', detail: 'Fixture integration', supported: true,
          available: () => true,
          async run() {
            context.lock([target], false);
            if (!await context.review({ id: 'fixture', sessions: [{ file: target.key, title }] })) return;
            context.lock([target], true);
            await context.stop([target]);
            context.progress('deleting');
            context.removed([target, target]);
          },
        };
      },
    };
  });
  assert.ok(source);
  f.coordinator.register(context => piSessionDeletion({
    panels: () => [], acknowledge: async () => {}, snapshot: async () => ({ pending: false, files: [], quarantine: [] }),
    run: async () => [], recover: async () => {}, confirm: async () => {},
  }, context));
  const operation = f.coordinator.operation(saved, 'Third harness')!;
  externalPending = true;
  assert.equal(operation.available(), false);
  assert.equal(f.coordinator.operation(reference, 'Copilot')!.available(), false);
  externalPending = false;
  f.ready(false); assert.equal(operation.available(), false);
  f.ready(true);
  await operation.run();
  assert.equal(operation.label, 'Delete fixture…');
  assert.equal(f.coordinator.removed(target.key), true);
  assert.equal(f.events.filter(event => event === 'reconcile:fixture:saved').length, 1);
  effect.removed([target]);
  assert.equal(f.events.filter(event => event === 'reconcile:fixture:saved').length, 1);
  effect.recovered(target.key);
  assert.equal(operation.available(), true);
  assert.deepEqual(f.errors, []);
});

test('an unrelated source release cannot dismiss the active review', async () => {
  const f = fixture();
  let effect!: SessionDeletionContext;
  f.coordinator.register(context => {
    effect = context; return { pending: false, operation: () => undefined };
  });
  f.history.validateDeletion = async () => { effect.closeReview(); };
  await f.coordinator.operation(reference, 'Saved')!.run();
  assert.equal(f.events.filter(event => event === 'close').length, 1);
  assert.ok(f.events.indexOf('close') > f.events.indexOf('delete:saved'));
});
