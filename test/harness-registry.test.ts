import assert from 'node:assert/strict';
import test from 'node:test';
import { HarnessRegistry, defineHarness } from '../src/harness-registry';
import type { HarnessSession } from '../src/harness-contract';
import { fixtureHarness } from './fixtures/fixture-harness';
import { harnessHostFixture } from './harness-fixture';
import { NativeDrafts, type NativeDraftRecord } from '../src/native-drafts';
import { SessionDrafts } from '../src/session-drafts';
import { SessionConnection } from '../src/session-connection';
import { loadSessionHistory } from '../src/session-history';
import { SessionDeletionCoordinator } from '../src/session-deletion-coordinator';
import { readSavedSidebarSession } from '../src/session-lifecycle';
import { savedDraftScope } from '../src/draft-scope';
import { availableSessionActions } from '../src/session-actions';
import { actionContextAvailable, bindingsFor } from '../src/keybindings';
import { pluginTargets } from '../src/card-plugin-targets';
import { genericCards, selectHarnessCard } from '../src/card-renderers';
import { createBundledHarnessRegistry } from '../src/bundled-harnesses';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test('registration alone connects an unknown harness through real input, draft, history, action and deletion consumers', async () => {
  const records = new Map<string, NativeDraftRecord>(), errors: unknown[] = [];
  const writer = new NativeDrafts('/fixture', error => errors.push(error), {
    load: async () => [...records.values()], stage: async (_project, record) => { records.set(record.key, structuredClone(record)); }, flush: async () => {},
  });
  const library = new SessionDrafts({ drafts: await writer.load() }, undefined, () => { throw new Error('whole-library write'); }, (key, value) => writer.change(key, value));
  const f = harnessHostFixture(library), registry = new HarnessRegistry([fixtureHarness], f.project, fixtureHarness.id);
  await registry.initialize();
  const project = registry.get(fixtureHarness.id); project.history.associate();
  const session = registry.create(project, f.host, { mode: 'saved' });
  f.host.drafts.write({ draft: 'Preserved before identity exists' });
  const coordinator = new SessionConnection({ selected: () => session, eligibility: selected => selected.lifecycle.eligibility(),
    connect: selected => selected.lifecycle.connect({ acceptedAction: true }), failed: (_selected, error) => errors.push(error) });
  coordinator.request(); coordinator.request(); await flush(); await writer.flush();
  assert.equal(session.lifecycle.connection, 'connected');
  const reference = session.lifecycle.identity!, scope = session.lifecycle.draftScope!;
  assert.equal(scope, savedDraftScope(fixtureHarness.id, reference.sessionId));
  assert.deepEqual(f.host.drafts.read(), { draft: 'Preserved before identity exists' });
  assert.deepEqual(records.get(scope)?.value, f.host.drafts.read()); assert.equal(records.get(`unassigned:${f.host.id}`)?.value, null);
  assert.equal(f.publications.some(message => message.type === 'submissionReceipt'), false, 'connect never submits a prompt');
  await session.conversation.messageInput.submit({ id: 'send', text: 'Explicit offline prompt', mode: 'normal' });
  assert.ok(f.publications.some(message => message.type === 'submissionReceipt' && message.outcome === 'accepted'));
  assert.equal(session.conversation.state?.messages?.at(-1)?.content, 'Offline fixture reply');
  const actions = availableSessionActions(session, async () => {}), question = actions.find(action => action.id === 'harness-fixture-question')!;
  assert.ok(question.run); await question.run();
  assert.match(f.notices.at(-1)!.message, /Which option/); assert.match(f.notices.at(-1)!.details!, /choices/);
  assert.deepEqual(f.host.drafts.read(), { draft: 'Preserved before identity exists' }, 'fallback question display never mutates input or sends an answer');
  assert.equal(actionContextAvailable('harness-fixture-question', { project: true, sessionActions: new Set(actions.map(action => action.id)) }), true);
  assert.deepEqual(bindingsFor('harness-new-fixture', {}), []);
  assert.deepEqual(pluginTargets([{ backend: fixtureHarness.id }]), [{ backend: fixtureHarness.id }]);
  assert.equal(selectHarnessCard({ source: { backend: fixtureHarness.id }, name: 'unknown', native: { question: 'literal' } }).id, 'nimrod.tool');
  const source = project.history.source()!, history = await loadSessionHistory([source], new AbortController().signal, () => {});
  assert.ok(history.entries.some(entry => entry.reference?.sessionId === reference.sessionId));
  const saved = readSavedSidebarSession({ ...reference, name: 'Restored fixture', lastUsed: 123 })!;
  assert.equal(registry.forReference(saved), project);
  const prepared = await project.saved.prepare(saved, { title: saved.name, lastUsed: saved.lastUsed }, true);
  const restored = harnessHostFixture(library, 'restored'); restored.host.drafts.select(scope);
  const reopened = registry.create(project, restored.host, prepared.request);
  assert.equal(reopened.selection.deferRestored, true); assert.equal(reopened.lifecycle.connection, 'disconnected');
  assert.deepEqual(restored.host.drafts.read(), { draft: 'Preserved before identity exists' });
  assert.equal(restored.publications.length, 0, 'restoration alone never connects or prompts');
  const removed: string[] = [];
  const deletion = new SessionDeletionCoordinator({ canRun: () => true,
    participants: () => [{ lock() {}, stop: () => session.lifecycle.stop() }],
    review: { loadingReview() {}, review: async () => true, progress() {}, closeReview() {} },
    deleted: targets => { for (const target of targets) { removed.push(target.key); library.deleteScope(target.draftScope); } },
    changed() {}, error: message => errors.push(message),
  });
  deletion.register(context => project.deletion(context));
  await deletion.operation(reference, 'Fixture session')!.run(); await writer.flush();
  assert.deepEqual(removed, [scope]); assert.equal(records.get(scope)?.value, null);
  assert.equal(session.restart.supported, false); assert.equal(session.configuration.current(), undefined);
  session.interactions.dispose(); reopened.interactions.dispose(); deletion.dispose(); registry.dispose();
  assert.deepEqual(errors, []); f.dom.window.close(); restored.dom.window.close();
});

test('project registrations expose executable actions before any session exists and preserve live availability', async () => {
  const f = harnessHostFixture(), registry = new HarnessRegistry([fixtureHarness], f.project, fixtureHarness.id);
  assert.equal(registry.projectActions()[0].available(), false);
  await registry.initialize();
  const action = registry.projectActions().find(action => action.id === 'harness-fixture-project')!;
  assert.equal(action.available(), true); assert.equal(actionContextAvailable(action.id, { project: true }), true);
  await action.run();
  assert.equal(f.project.store.read('fixture-project-runs'), 1); assert.equal(f.publications.length, 0);
  f.retire(); assert.equal(action.available(), false); registry.dispose(); f.dom.window.close();
});

test('generic card defaults retain literal native metadata without trusting mutable caller identity', () => {
  const native = { question: 'Original' }, renderer = genericCards({});
  assert.ok(!('apiVersion' in renderer));
  const mounted = renderer.mount();
  assert.match(mounted.update({ native }).sections.find(section => section.key === 'native')!.text, /Original/);
  native.question = 'Changed';
  assert.match(mounted.update({ native }).sections.find(section => section.key === 'native')!.text, /Changed/);
  mounted.dispose();
});

test('registered factories reject duplicate/unknown identities and unsupported creation before construction', () => {
  const f = harnessHostFixture(), registry = new HarnessRegistry([fixtureHarness], f.project, fixtureHarness.id);
  assert.throws(() => new HarnessRegistry([fixtureHarness, fixtureHarness], f.project, fixtureHarness.id), /Duplicate/);
  assert.throws(() => registry.forReference({ kind: 'unregistered', sessionId: 'same' }), /no registered harness/);
  assert.throws(() => registry.create(registry.get(fixtureHarness.id), f.host, { mode: 'temporary' }), /does not support/);
  assert.throws(() => registry.create(registry.get(fixtureHarness.id), f.host, { mode: 'saved', initialName: 'Not supported' }), /initial naming/);
  assert.throws(() => registry.create(registry.get(fixtureHarness.id), f.host, { mode: 'resume', reference: { kind: 'another', sessionId: 'same' } }), /another harness/);
  f.dom.window.close();
});

test('inconsistent identity/key projections are refused before a session reaches application consumers', () => {
  const f = harnessHostFixture();
  const registration = defineHarness({ ...fixtureHarness, create(host: import('../src/harness-host').HarnessProjectHost) {
    const project = fixtureHarness.create(host);
    return { ...project, create(sessionHost: import('../src/harness-host').HarnessSessionHost, request: import('../src/harness-contract').SessionRequest): HarnessSession {
      const session = project.create(sessionHost, request);
      return { ...session, lifecycle: { ...session.lifecycle, key: 'wrong-owner' } };
    } };
  } });
  const registry = new HarnessRegistry([registration], f.project, registration.id), project = registry.get(registration.id);
  assert.throws(() => registry.create(project, f.host, { mode: 'saved' }), /without a durable identity/);
  assert.throws(() => registry.create(project, f.host, { mode: 'resume', reference: { kind: registration.id, sessionId: 'saved' } }), /disagree/);
  assert.equal(f.publications.length, 0); f.dom.window.close();
});

class PrototypeSession implements HarnessSession {
  constructor(private readonly inner: HarnessSession) {}
  get lifecycle() { return this.inner.lifecycle; } get conversation() { return this.inner.conversation; }
  get presentation() { return this.inner.presentation; } get configuration() { return this.inner.configuration; }
  get actions() { return this.inner.actions; } get restart() { return this.inner.restart; }
  get close() { return this.inner.close; } get drafts() { return this.inner.drafts; }
  get selection() { return this.inner.selection; } get interactions() { return this.inner.interactions; }
  get references() { return this.inner.references; }
}
test('class/prototype implementations retain their live ports across registry binding', async () => {
  const f = harnessHostFixture();
  const registration = defineHarness({ ...fixtureHarness, create(host: import('../src/harness-host').HarnessProjectHost) {
    const project = fixtureHarness.create(host);
    return { ...project, create: (sessionHost: import('../src/harness-host').HarnessSessionHost, request: import('../src/harness-contract').SessionRequest) => new PrototypeSession(project.create(sessionHost, request)) };
  } });
  const registry = new HarnessRegistry([registration], f.project, registration.id);
  await registry.initialize(); const session = registry.create(registry.get(registration.id), f.host, { mode: 'saved' });
  assert.equal(session.lifecycle.connection, 'disconnected'); await session.lifecycle.connect(); assert.equal(session.lifecycle.connection, 'connected');
  f.dom.window.close();
});

test('removed legacy Copilot ACP references remain unregistered rather than aliasing SDK history', () => {
  const f = harnessHostFixture(), registry = createBundledHarnessRegistry(f.project);
  const legacy = readSavedSidebarSession({ kind: 'acp', profile: 'copilot', sessionId: 'same-id', name: 'Old', lastUsed: 100 })!;
  assert.throws(() => registry.forReference(legacy), /no registered harness/);
  assert.equal(registry.forReference({ kind: 'copilot-sdk', sessionId: 'same-id' }).id, 'copilot-sdk');
  // Factory construction only: no initialize/native/model operation.
  f.dom.window.close();
});
