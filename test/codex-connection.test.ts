import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexConnection, type CodexConnectionHost, type CodexBackend } from '../src/codex/connection';
import type { CodexPacket } from '../src/codex/protocol';
import { codexScope } from '../src/codex/session-lifecycle';
import { SessionDrafts } from '../src/session-drafts';
import { NativeDrafts, type NativeDraftRecord } from '../src/native-drafts';
import { SessionConnection } from '../src/session-connection';
import { readSavedSidebarSession, type SessionLifecycleOwner } from '../src/session-lifecycle';
import type { ConversationViewMessage } from '../src/conversation-view-host';

const project = '/fixture/codex';
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture(options: { savedId?: string; continuity?: CodexBackend['continuity']; freshId?: string; checkpoint?: () => Promise<void>; rejectResume?: boolean; bindError?: string; startGate?: Promise<string>; stop?: (token: string) => Promise<void> } = {}) {
  const owner: SessionLifecycleOwner = { starting: false, ended: true };
  const backend: CodexBackend = { savedSessionId: options.savedId, continuity: options.continuity };
  const packets: CodexPacket[] = [], stops: string[] = [], starts: string[] = [], stages: NativeDraftRecord[] = [], errors: unknown[] = [];
  const publications: ConversationViewMessage[] = [], failures: Parameters<CodexConnectionHost['effects']['failure']>[0][] = [];
  const resolutions: string[] = [], identities: unknown[] = [];
  const writer = new NativeDrafts(project, error => errors.push(error), {
    load: async () => [], stage: async (_project, record) => { stages.push(record); }, flush: async () => {},
  });
  const drafts = new SessionDrafts(undefined, undefined, () => { throw new Error('whole-library writes forbidden'); }, (key, value) => writer.change(key, value));
  drafts.select(options.savedId ? codexScope(options.savedId) : 'unassigned:new'); drafts.write({ draft: 'Keep newer draft' });
  let current = true, available = true, tearingDown = false, conflict = false, hasOutcome = false;
  let receive: (packet: unknown) => void = () => {};
  let disconnected: (message: string) => void = () => {};
  const lifecycle = createCodexConnection(() => owner, backend, {
    project, current: () => current, available: () => available, tearingDown: () => tearingDown,
    conflicts: () => conflict, gate: () => available ? 'ready' : 'blocked',
    drafts: { read: () => drafts.read(), replaceScope: (previous, scope) => drafts.replaceScope(previous, scope), bindScope: scope => { if (options.bindError) throw new Error(options.bindError); drafts.bindScope(scope); } },
    transport: {
      start: async (token, packet, ended) => { starts.push(token); receive = packet; disconnected = ended; return options.startGate ?? project; },
      stop: async token => { stops.push(token); await options.stop?.(token); },
      write: async (_token, packet) => {
        packets.push(packet);
        if (packet.method === 'initialized' || packet.method === undefined) return;
        if (packet.method === 'turn/start' || packet.method === 'thread/compact/start' || packet.method === 'thread/name/set' || options.rejectResume && packet.method === 'thread/resume') {
          receive({ id: packet.id, error: { code: -32000, message: packet.method === 'thread/resume' ? 'no rollout found' : 'fixture rejection after possible delivery' } }); return;
        }
        let result: unknown;
        if (packet.method === 'initialize') result = { userAgent: 'fixture/0.164.0' };
        else if (packet.method === 'thread/start' || packet.method === 'thread/resume') result = {
          cwd: project, thread: { id: packet.method === 'thread/start' ? options.freshId ?? 'thread' : options.savedId ?? 'thread', cwd: project, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'idle' } }, model: 'fixture-model', reasoningEffort: 'low',
        };
        else if (packet.method === 'thread/turns/list' || packet.method === 'model/list') {
          assert.equal(lifecycle.draftScope, codexScope(backend.savedSessionId!), 'identity and real drafts bind before history/catalog');
          assert.deepEqual(drafts.read(), { draft: 'Keep newer draft' });
          result = { data: [], nextCursor: null };
        } else throw new Error(`Unexpected provider-facing operation: ${String(packet.method)}`);
        receive({ id: packet.id, result });
      },
    },
    ui: { publish: message => publications.push(message), changed() {}, notice: message => errors.push(message),
      approval: async () => 'cancel', completed() {} },
    effects: { changed() {}, retire() {}, checkpoint: async () => { await options.checkpoint?.(); }, identified: () => identities.push(lifecycle.identity),
      resolved: issue => resolutions.push(issue), hasConnectionOutcome: () => hasOutcome, failure: failure => failures.push(failure) },
  });
  const coordinator = new SessionConnection({ selected: () => lifecycle, eligibility: target => target.eligibility(),
    connect: target => target.connect({ acceptedAction: true }), failed: (_target, error) => errors.push(error) });
  return { owner, backend, lifecycle, coordinator, packets, stops, starts, publications, failures, resolutions, identities, stages, writer, drafts, errors,
    disconnect: (message: string) => disconnected(message),
    retire: () => { current = false; }, block: () => { available = false; },
    teardown: () => { tearingDown = true; }, conflict: () => { conflict = true; }, outcome: () => { hasOutcome = true; } };
}

test('Codex connection owner binds actual drafts before readiness, and selection/Close use the same ports', async () => {
  const f = fixture();
  await f.lifecycle.connect({ acceptedAction: true }); await f.writer.flush();
  assert.equal(f.lifecycle.connection, 'connected'); assert.equal(f.owner.starting, false);
  assert.deepEqual(f.identities, [{ kind: 'codex', sessionId: 'thread', codexContinuity: { version: 1, untouched: true, saved: false } }]);
  assert.ok(f.stages.some(record => record.key === codexScope('thread') && record.value !== null));
  assert.ok(f.stages.some(record => record.key === 'unassigned:new' && record.value === null));
  assert.equal(f.packets.some(packet => packet.method === 'turn/start'), false);
  await f.lifecycle.stop(); f.lifecycle.disconnect('Closed by user'); await flush();
  assert.deepEqual(f.stops, f.starts, 'observed stop and disconnect cleanup share token work');
  assert.equal(f.lifecycle.connection, 'disconnected'); assert.equal(f.lifecycle.draftScope, codexScope('thread'));
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  f.coordinator.request(); f.coordinator.request(); await flush();
  assert.equal(f.starts.length, 2); assert.equal(f.lifecycle.connection, 'connected');
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 2);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 0);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
  assert.deepEqual(f.errors, []);
});

test('persisted untouched Codex rows start a fresh thread and promote only their own draft', async () => {
  const f = fixture({ savedId: 'old-empty-thread', freshId: 'fresh-thread',
    continuity: { version: 1, untouched: true, saved: false } });
  f.drafts.select('unassigned:sibling'); f.drafts.write({ draft: 'Sibling' });
  f.drafts.select(codexScope('old-empty-thread'));
  await f.lifecycle.connect();
  assert.equal(f.backend.savedSessionId, 'fresh-thread');
  assert.equal(f.lifecycle.draftScope, codexScope('fresh-thread'));
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  assert.equal(f.packets.some(packet => packet.method === 'thread/resume' || packet.method === 'turn/start'), false);
  const persisted = readSavedSidebarSession({ ...f.lifecycle.identity, name: 'Kept title', lastUsed: 123, pinned: true })!;
  assert.deepEqual('kind' in persisted && persisted.codexContinuity, { version: 1, untouched: true, saved: false });
  f.drafts.select('unassigned:sibling'); assert.deepEqual(f.drafts.read(), { draft: 'Sibling' });
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('first history-producing dispatch waits for persisted uncertainty, not its acknowledgement', async () => {
  let release!: () => void, checkpoints = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ checkpoint: async () => { checkpoints++; await gate; } });
  await f.lifecycle.connect();
  const attempt = f.backend.session!.client.startTurn('Never replay', 'first-send');
  const rejected = assert.rejects(attempt, /fixture rejection/);
  await flush();
  assert.equal(f.backend.continuity?.untouched, false);
  assert.equal(checkpoints, 1);
  assert.equal(f.packets.some(packet => packet.method === 'turn/start'), false);
  release(); await rejected;
  const persisted = readSavedSidebarSession({ ...f.lifecycle.identity, name: 'Session', lastUsed: 123 })!;
  assert.equal('kind' in persisted && persisted.codexContinuity?.untouched, false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('failed lifecycle checkpoint never delivers the first input or makes it replaceable', async () => {
  const f = fixture({ checkpoint: async () => { throw new Error('disk unavailable'); } });
  await f.lifecycle.connect();
  await assert.rejects(f.backend.session!.client.startTurn('Never deliver', 'first-send'));
  assert.equal(f.packets.some(packet => packet.method === 'turn/start'), false);
  assert.equal(f.backend.continuity?.untouched, false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('legacy and possibly-used missing threads never fall back to creation', async () => {
  for (const continuity of [undefined, { version: 1 as const, untouched: false, saved: false }, { version: 1 as const, untouched: false, saved: true }]) {
    const f = fixture({ savedId: 'missing-thread', continuity, rejectResume: true });
    await f.lifecycle.connect();
    assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 1);
    assert.equal(f.packets.some(packet => packet.method === 'thread/start'), false);
    assert.equal(f.backend.savedSessionId, 'missing-thread');
    assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
    assert.match(f.failures.at(-1)!.message, /no rollout found/);
  }
});

test('successful exact Resume establishes saved history without changing the draft scope', async () => {
  const f = fixture({ savedId: 'persisted-thread', continuity: { version: 1, untouched: false, saved: false } });
  await f.lifecycle.connect();
  assert.deepEqual(f.backend.continuity, { version: 1, untouched: false, saved: true });
  assert.equal(f.lifecycle.draftScope, codexScope('persisted-thread'));
  assert.equal(f.packets.some(packet => packet.method === 'thread/start' || packet.method === 'turn/start'), false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('scope replacement retains image references and rejects sibling collisions without mutation', () => {
  const drafts = new SessionDrafts(undefined, undefined, () => {});
  const imageDraft = { draft: 'Image draft', attachments: [{ id: 'image', mimeType: 'image/png', data: 'fixture-bytes' }] };
  drafts.select('unassigned:empty'); drafts.write(imageDraft); drafts.bindScope(codexScope('old'));
  drafts.select('unassigned:sibling'); drafts.write({ draft: 'Sibling' }); drafts.bindScope(codexScope('occupied'));
  drafts.select(codexScope('old'));
  assert.throws(() => drafts.replaceScope(codexScope('old'), codexScope('occupied')), /already has a local draft/);
  assert.deepEqual(drafts.read(), imageDraft);
  drafts.replaceScope(codexScope('old'), codexScope('fresh'));
  assert.deepEqual(drafts.read(), imageDraft);
  drafts.select(codexScope('old')); assert.equal(drafts.read(), undefined);
  drafts.select(codexScope('occupied')); assert.deepEqual(drafts.read(), { draft: 'Sibling' });
});

test('failed owned shutdown cannot recreate an untouched Codex thread', async () => {
  const f = fixture({ savedId: 'old', continuity: { version: 1, untouched: true, saved: false },
    stop: async () => { throw new Error('exit unconfirmed'); } });
  f.owner.token = 'previous';
  await f.lifecycle.connect();
  assert.deepEqual(f.starts, []);
  assert.equal(f.backend.savedSessionId, 'old');
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
});

test('Codex continuity decoding never turns malformed or legacy metadata into untouched evidence', () => {
  const row = { kind: 'codex', sessionId: 'thread', name: 'Session', lastUsed: 123 };
  assert.deepEqual(readSavedSidebarSession(row), row);
  for (const codexContinuity of [null, {}, { version: 2, untouched: true, saved: false }, { version: 1, untouched: 'true', saved: false }, { version: 1, untouched: true, saved: true }])
    assert.equal(readSavedSidebarSession({ ...row, codexContinuity }), undefined);
});

test('Codex original binding failure survives cleanup failure without retry or fabricated readiness', async () => {
  const f = fixture({ bindError: 'Local identity binding failed', stop: async () => { throw new Error('EPERM while observing owned exit'); } });
  await f.lifecycle.connect({ acceptedAction: true });
  assert.equal(f.lifecycle.connection, 'disconnected'); assert.equal(f.lifecycle.identity, undefined);
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  assert.equal(f.stops.length, 1); assert.equal(f.starts.length, 1);
  assert.match(f.failures.at(-1)!.message, /startup failed: Local identity binding failed/);
  assert.doesNotMatch(f.failures.at(-1)!.message, /EPERM/); assert.match(f.failures.at(-1)!.details!, /EPERM/);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  assert.equal(f.packets.some(packet => packet.method === 'model/list' || packet.method === 'turn/start'), false);
  assert.equal(f.owner.token, f.starts[0], 'failed teardown retains the owned token');
});

test('Codex replacement waits for previous owned exit and a failed stop cannot start a child', async () => {
  let fail = true;
  const f = fixture({ savedId: 'thread', stop: async () => { if (fail) throw new Error('exit unconfirmed'); } });
  f.owner.token = 'previous';
  await f.lifecycle.connect();
  assert.deepEqual(f.stops, ['previous']); assert.deepEqual(f.starts, []);
  assert.equal(f.lifecycle.connection, 'disconnected'); assert.equal(f.owner.starting, false);
  assert.equal(f.owner.token, 'previous');
  fail = false;
  await f.lifecycle.connect();
  assert.deepEqual(f.stops, ['previous', 'previous']); assert.equal(f.starts.length, 1);
  assert.equal(f.lifecycle.connection, 'connected');
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('retired Codex start completion cleans only its captured token, never replacement state or drafts', async () => {
  let release!: (project: string) => void;
  const f = fixture({ startGate: new Promise(resolve => { release = resolve; }) });
  const attempt = f.lifecycle.connect(); await flush();
  const old = f.owner.token!;
  f.owner.token = 'replacement'; f.owner.starting = true;
  f.drafts.write({ draft: 'Newer replacement draft' });
  release(project); await attempt; await f.writer.flush();
  assert.deepEqual(f.stops, [old]); assert.equal(f.owner.token, 'replacement'); assert.equal(f.owner.starting, true);
  assert.deepEqual(f.drafts.read(), { draft: 'Newer replacement draft' });
  assert.equal(f.packets.length, 0); assert.deepEqual(f.failures, []);
});

test('removed Codex owner never initializes after native launch completes', async () => {
  let release!: (project: string) => void;
  const f = fixture({ startGate: new Promise(resolve => { release = resolve; }) });
  const attempt = f.lifecycle.connect(); await flush(); f.retire(); release(project); await attempt;
  assert.deepEqual(f.stops, f.starts); assert.equal(f.packets.length, 0); assert.deepEqual(f.failures, []);
});

test('Codex capability/ownership gates prevent launch without touching drafts', async () => {
  for (const gate of ['blocked', 'conflict'] as const) {
    const f = fixture({ savedId: 'thread' });
    if (gate === 'blocked') f.block(); else f.conflict();
    await f.lifecycle.connect();
    assert.deepEqual(f.starts, []); assert.deepEqual(f.stops, []);
    assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  }
});

test('established disconnect cleanup failure is independent when a transcript operation owns the outcome', async () => {
  const f = fixture({ stop: async () => { throw new Error('exit unconfirmed'); } });
  await f.lifecycle.connect(); f.outcome(); f.disconnect('transport closed'); await flush();
  assert.equal(f.stops.length, 1); assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].kind, 'cleanup'); assert.match(f.failures[0].details!, /transport closed/);
});
