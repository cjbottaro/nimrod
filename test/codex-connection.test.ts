import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexConnection, type CodexConnectionHost, type CodexBackend } from '../src/codex/connection';
import type { CodexPacket } from '../src/codex/protocol';
import { codexScope } from '../src/codex/session-lifecycle';
import { SessionDrafts } from '../src/session-drafts';
import { NativeDrafts, type NativeDraftRecord } from '../src/native-drafts';
import { SessionConnection } from '../src/session-connection';
import { codexConnectionFailure } from '../src/codex/connection-failure';
import { readSavedSidebarSession, type SessionLifecycleOwner } from '../src/session-lifecycle';
import type { ConversationViewMessage } from '../src/conversation-view-host';

const project = '/fixture/codex';
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function fixture(options: { savedId?: string; initialName?: string; renameGate?: Promise<void>; renameError?: string; historyAvailable?: boolean; freshId?: string; rejectResume?: boolean; bindError?: string; startGate?: Promise<string>; stop?: (token: string) => Promise<void> } = {}) {
  const owner: SessionLifecycleOwner = { starting: false, ended: true };
  const backend: CodexBackend = { savedSessionId: options.savedId };
  const packets: CodexPacket[] = [], stops: string[] = [], starts: string[] = [], stages: NativeDraftRecord[] = [], errors: unknown[] = [];
  const nameFailures: unknown[] = [];
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
    project, initialName: options.initialName, current: () => current, available: () => available, tearingDown: () => tearingDown,
    conflicts: () => conflict, gate: () => available ? 'ready' : 'blocked',
    drafts: { read: () => drafts.read(), bindScope: scope => { if (options.bindError) throw new Error(options.bindError); drafts.bindScope(scope); } },
    transport: {
      start: async (token, packet, ended) => { starts.push(token); receive = packet; disconnected = ended; return options.startGate ?? project; },
      stop: async token => { stops.push(token); await options.stop?.(token); },
      write: async (_token, packet) => {
        packets.push(packet);
        if (packet.method === 'initialized' || packet.method === undefined) return;
        if (packet.method === 'turn/start' || packet.method === 'thread/compact/start' || options.rejectResume && packet.method === 'thread/resume') {
          receive({ id: packet.id, error: { code: -32000, message: packet.method === 'thread/resume' ? `no rollout found for thread id ${options.savedId}` : 'fixture rejection after possible delivery' } }); return;
        }
        if (packet.method === 'thread/name/set') {
          await options.renameGate;
          if (options.renameError) receive({ id: packet.id, error: { code: -32000, message: options.renameError } });
          else receive({ id: packet.id, result: {} });
          return;
        }
        if (packet.method === 'thread/turns/list' && !backend.historyConfirmed && !options.historyAvailable) {
          receive({ id: packet.id, error: { code: -32600, message: 'thread/turns/list is unavailable before first user message' } }); return;
        }
        let result: unknown;
        if (packet.method === 'initialize') result = { userAgent: 'fixture/0.164.0' };
        else if (packet.method === 'thread/read') result = { thread: {
          id: options.savedId ?? 'thread', cwd: project, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'notLoaded' },
        } };
        else if (packet.method === 'thread/start' || packet.method === 'thread/resume') result = {
          cwd: project, thread: { id: packet.method === 'thread/start' ? options.freshId ?? 'thread' : options.savedId ?? 'thread', cwd: project, ephemeral: false, parentThreadId: null, turns: [], status: { type: 'idle' } }, model: 'fixture-model', reasoningEffort: 'low',
        };
        else if (packet.method === 'thread/turns/list' || packet.method === 'model/list') {
          assert.equal(lifecycle.draftScope, codexScope(backend.savedSessionId!), 'identity and real drafts bind before history/catalog');
          result = { data: [], nextCursor: null };
        } else throw new Error(`Unexpected provider-facing operation: ${String(packet.method)}`);
        receive({ id: packet.id, result });
      },
    },
    ui: { publish: message => publications.push(message), changed() {}, notice: message => errors.push(message),
      approval: async () => 'cancel', completed() {} },
    effects: { changed() {}, nameFailed: error => nameFailures.push(error), retire() {}, identified: () => identities.push(lifecycle.identity),
      resolved: issue => resolutions.push(issue), hasConnectionOutcome: () => hasOutcome, failure: failure => failures.push(failure) },
  });
  const coordinator = new SessionConnection({ selected: () => lifecycle, eligibility: target => target.eligibility(),
    connect: target => target.connect({ acceptedAction: true }), failed: (_target, error) => errors.push(error) });
  return { owner, backend, lifecycle, coordinator, nameFailures, packets, stops, starts, publications, failures, resolutions, identities, stages, writer, drafts, errors,
    disconnect: (message: string) => disconnected(message),
    retire: () => { current = false; }, block: () => { available = false; },
    teardown: () => { tearingDown = true; }, conflict: () => { conflict = true; }, outcome: () => { hasOutcome = true; } };
}

test('Codex connection owner binds actual drafts before readiness, and selection/Close use the same ports', async () => {
  const f = fixture();
  await f.lifecycle.connect({ acceptedAction: true }); await f.writer.flush();
  assert.equal(f.lifecycle.connection, 'connected'); assert.equal(f.owner.starting, false);
  assert.deepEqual(f.identities, [{ kind: 'codex', sessionId: 'thread' }]);
  assert.ok(f.stages.some(record => record.key === codexScope('thread') && record.value !== null));
  assert.ok(f.stages.some(record => record.key === 'unassigned:new' && record.value === null));
  assert.equal(f.packets.some(packet => packet.method === 'turn/start'), false);
  await f.lifecycle.stop(); f.lifecycle.disconnect('Closed by user'); await flush();
  assert.deepEqual(f.stops, f.starts, 'observed stop and disconnect cleanup share token work');
  assert.equal(f.lifecycle.connection, 'disconnected'); assert.equal(f.lifecycle.draftScope, codexScope('thread'));
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  f.coordinator.request(); f.coordinator.request(); await flush();
  assert.equal(f.starts.length, 2); assert.equal(f.lifecycle.connection, 'connected');
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 1);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
  assert.deepEqual(f.errors, []);
});

test('Codex initial naming is one create-then-rename attempt and does not gate readiness or drafting', async () => {
  let release!: () => void;
  const f = fixture({ initialName: '  Initial name  ', historyAvailable: true, renameGate: new Promise(resolve => { release = resolve; }) });
  await f.lifecycle.connect();
  assert.equal(f.owner.starting, false); assert.equal(f.lifecycle.connection, 'connected');
  assert.equal(f.backend.session!.hasPendingWork, true, 'Close/Reload sees the pending rename');
  const rename = f.packets.find(packet => packet.method === 'thread/name/set')!;
  assert.deepEqual(rename.params, { threadId: 'thread', name: 'Initial name' });
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  f.drafts.write({ draft: 'Newer draft' }); release(); await flush();
  assert.equal(f.backend.session!.state.sessionName, 'Initial name');
  assert.deepEqual(f.drafts.read(), { draft: 'Newer draft' });
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
  // A separate connect resumes the exact identity, never reapplying the creation name.
  await f.lifecycle.connect(); await flush();
  assert.equal(f.packets.filter(packet => packet.method === 'thread/name/set').length, 1);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 1);
  assert.equal(f.packets.some(packet => packet.method === 'turn/start'), false);
  assert.equal(f.nameFailures.length, 0);
  await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('Codex initial rename rejection retains the created thread and is never replayed on reconnect', async () => {
  const f = fixture({ initialName: 'Requested name', renameError: 'Name rejected' });
  await f.lifecycle.connect(); await flush();
  assert.equal(f.lifecycle.connection, 'connected'); assert.equal(f.backend.savedSessionId, 'thread');
  assert.equal(f.stops.length, 0); assert.match(String(f.nameFailures[0]), /Name rejected/);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  await f.lifecycle.stop(); f.lifecycle.disconnect('retry connection'); await f.lifecycle.connect(); await flush();
  assert.equal(f.packets.filter(packet => packet.method === 'thread/name/set').length, 1);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('Codex retired initial rename completion cannot publish into another owner', async () => {
  let release!: () => void;
  const f = fixture({ initialName: 'Old name', renameError: 'Late failure', renameGate: new Promise(resolve => { release = resolve; }) });
  await f.lifecycle.connect(); f.retire(); release(); await flush();
  assert.equal(f.nameFailures.length, 0);
  assert.equal(f.backend.session!.state.sessionName, undefined);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('Codex Resume ignores initial naming and invalid new names never launch', async () => {
  const f = fixture({ savedId: 'existing', initialName: 'Must not apply' });
  await f.lifecycle.connect(); await flush();
  assert.equal(f.packets.some(packet => packet.method === 'thread/name/set' || packet.method === 'thread/start'), false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
  assert.throws(() => fixture({ initialName: 'Invalid\nname' }), /single-line/);
});

test('retired untouched markers never replace an exact reconnect candidate or move its draft', async () => {
  const legacy = { kind: 'codex', sessionId: 'old-empty-thread', name: 'Kept title', lastUsed: 123, pinned: true };
  for (const codexContinuity of [{ version: 1, untouched: true, saved: false }, { version: 1, untouched: false, saved: false }, { version: 1, untouched: false, saved: true }, null, {}]) {
    const restored = readSavedSidebarSession({ ...legacy, codexContinuity })!;
    assert.deepEqual(restored, legacy, 'retired evidence is ignored, without dropping membership');
    const f = fixture({ savedId: restored.sessionId, freshId: 'must-not-create', rejectResume: true });
    f.drafts.select('unassigned:sibling'); f.drafts.write({ draft: 'Sibling' });
    f.drafts.select(codexScope(restored.sessionId));
    await f.lifecycle.connect();
    assert.equal(f.backend.savedSessionId, restored.sessionId);
    assert.equal(f.lifecycle.draftScope, codexScope(restored.sessionId));
    assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
    assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 1);
    assert.equal(f.packets.some(packet => ['thread/start', 'thread/name/set', 'turn/start'].includes(String(packet.method))), false);
    assert.match(f.failures.at(-1)!.message, /no saved history/);
    assert.match(f.failures.at(-1)!.details!, /no rollout found/);
    f.drafts.select('unassigned:sibling'); assert.deepEqual(f.drafts.read(), { draft: 'Sibling' });
  }
});

test('a runtime-only start does not imply saved history, and delivery has no private checkpoint gate', async () => {
  const f = fixture();
  await f.lifecycle.connect(); await flush();
  assert.equal(f.backend.historyConfirmed, false);
  assert.deepEqual(f.lifecycle.identity, { kind: 'codex', sessionId: 'thread' });
  await assert.rejects(f.backend.session!.client.startTurn('Never replay', 'first-send'), /fixture rejection/);
  assert.equal(f.packets.filter(packet => packet.method === 'turn/start').length, 1);
  assert.equal(f.packets.filter(packet => packet.method === 'thread/start').length, 1);
  assert.equal(f.backend.historyConfirmed, false, 'a rejected Send cannot establish durable history');
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('successful saved-history reads confirm even an empty native thread without provider work', async () => {
  const f = fixture({ historyAvailable: true });
  await f.lifecycle.connect(); await flush();
  assert.equal(f.backend.historyConfirmed, true);
  assert.equal(f.packets.some(packet => ['turn/start', 'thread/name/set'].includes(String(packet.method))), false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('successful exact Resume establishes saved history without changing the draft scope', async () => {
  const f = fixture({ savedId: 'persisted-thread' });
  await f.lifecycle.connect();
  assert.equal(f.backend.historyConfirmed, true);
  assert.equal(f.lifecycle.draftScope, codexScope('persisted-thread'));
  assert.equal(f.packets.some(packet => packet.method === 'thread/start' || packet.method === 'turn/start'), false);
  f.teardown(); await f.lifecycle.stop(); f.lifecycle.disconnect('done');
});

test('legacy missing threads never fall back to creation', async () => {
  const f = fixture({ savedId: 'missing-thread', rejectResume: true });
  await f.lifecycle.connect();
  assert.equal(f.packets.filter(packet => packet.method === 'thread/resume').length, 1);
  assert.equal(f.packets.some(packet => packet.method === 'thread/start'), false);
  assert.equal(f.backend.savedSessionId, 'missing-thread');
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
});

test('missing history diagnostics are concise and never claim that saved history exists', () => {
  const failure = codexConnectionFailure('no rollout found for thread id missing-thread', true);
  assert.ok(failure.message.length <= 160);
  assert.match(failure.message, /no saved history/);
  assert.doesNotMatch(failure.message, /missing-thread|Saved history.*remain/);
  assert.match(failure.details, /no rollout found for thread id missing-thread/);
  assert.match(failure.details, /Nothing was replaced, renamed or replayed/);
});

test('Codex original binding failure survives cleanup failure without retry or fabricated readiness', async () => {
  const f = fixture({ bindError: 'Local identity binding failed', stop: async () => { throw new Error('EPERM while observing owned exit'); } });
  await f.lifecycle.connect({ acceptedAction: true });
  assert.equal(f.lifecycle.connection, 'disconnected'); assert.equal(f.lifecycle.identity, undefined);
  assert.deepEqual(f.drafts.read(), { draft: 'Keep newer draft' });
  assert.equal(f.stops.length, 1); assert.equal(f.starts.length, 1);
  assert.match(f.failures.at(-1)!.message, /startup failed/);
  assert.match(f.failures.at(-1)!.details!, /Local identity binding failed/);
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
