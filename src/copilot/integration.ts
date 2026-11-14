import { invoke } from '@tauri-apps/api/core';
import { CopilotSession } from './session';
import { copilotSessionName } from './session-name';
import { copilotSessionLifecycle, copilotSdkScope } from './session-lifecycle';
import { copilotInteraction, copilotSessionActions } from './view-policy';
import { CopilotSessionHistory, copilotHistoryKey } from './session-history';
import { copilotSessionDeletion } from './session-deletion';
import { copilotTransport } from './native';
import { copilotIntegrationUi } from './integration-ui';
import { bundledCopilotPlugin } from './card-plugins';
import { startupAvailability } from '../harness-availability';
import { defineHarness } from '../harness-registry';
import { configurationActions, noProjectActions, noReferences, ordinarySelection, savedClose, taggedSavedSessions } from '../harness-defaults';
import { conversationPort } from '../harness-conversation';
import { bindSessionCommands } from '../session-commands';
import { ownedProcessStop } from '../session-lifecycle';
import type { HarnessProject, HarnessSession, SessionRequest } from '../harness-contract';
import type { HarnessProjectHost, HarnessSessionHost } from '../harness-host';

const creation = { defaultMode: 'saved', modes: ['saved'], named: true, validateName: copilotSessionName, title: 'Copilot session' } satisfies import('../harness-contract').HarnessCreation;
export const copilotHarness = defineHarness({ creation, cards: bundledCopilotPlugin, id: 'copilot-sdk', label: 'Copilot', actions: [], create: createCopilotProject });
function createCopilotProject(projectHost: HarnessProjectHost): HarnessProject {
  const availability = startupAvailability(() => invoke<boolean>('copilot_runtime_available', { cli: projectHost.runtime().copilot, node: projectHost.runtime().node }));
  let ready = false, generation = '', history: CopilotSessionHistory | undefined;
  const historyError = (error: unknown) => { if (projectHost.current()) projectHost.notice({ id: 'history:copilot-sdk', operation: 'Read Copilot history', message: String(error) }); };
  let initializing: Promise<void> | undefined;
  const initialize = (): Promise<void> => initializing ??= (async () => {
    try {
      const result = await invoke<string>('stop_copilot');
      if (!result) throw new Error('Native Copilot host did not confirm a new window generation');
      if (projectHost.current()) { generation = result; ready = true; source(); projectHost.changed(); }
    } catch (error) { if (projectHost.current()) projectHost.notice({ id: 'copilot-startup', operation: 'Initialize Copilot', message: `Copilot is unavailable; other harnesses remain available. ${String(error)}` }); }
  })();
  const source = ({ discover = false } = {}): CopilotSessionHistory | undefined => {
    const project = projectHost.project();
    if (!availability.available() || !project || !projectHost.current() || !discover && !history && (!ready || projectHost.store.read(copilotHistoryKey(project)) !== true)) return;
    if (!history) {
      const transport = copilotTransport(project, projectHost.runtime, () => generation);
      history = new CopilotSessionHistory(project, { ...transport, async start(...args) {
        await initialize();
        if (!ready || !projectHost.current()) throw new Error('Copilot history host is unavailable');
        return transport.start(...args);
      }, error: error => { historyError(error); projectHost.changed(); } });
      if (!discover) void history.initialize().then(projectHost.changed).catch(historyError);
    }
    return history;
  };
  return {
    id: 'copilot-sdk', label: 'Copilot',
    creation, actions: noProjectActions,
    availability,
    initialization: { blocking: false, ready: () => ready && availability.available(), run: initialize },
    saved: taggedSavedSessions('copilot-sdk'),
    history: { source, associate() { const project = projectHost.project(); if (project) { projectHost.store.save(copilotHistoryKey(project), true); source(); } }, async dispose() { await history?.dispose(); } },
    deletion: context => copilotSessionDeletion(() => history, context),
    create: (host, request) => createCopilotSession(host, request, projectHost, () => ready && availability.available(), () => generation, () => source()),
    dispose() { void history?.dispose().catch(historyError); },
  };
}

function createCopilotSession(host: HarnessSessionHost, request: SessionRequest, project: HarnessProjectHost, ready: () => boolean, generation: () => string, history: () => CopilotSessionHistory | undefined): HarnessSession {
  const backend: { session?: CopilotSession; savedSessionId?: string } = { savedSessionId: request.mode === 'resume' ? request.reference.sessionId : undefined };
  const { ownership: owner, lifetime, effects } = host;
  const transport = copilotTransport(host.project, project.runtime, generation);
  const stopToken = ownedProcessStop(transport.stop);
  const ui = copilotIntegrationUi(host);
  let signature = '', sequence = 0, retiring = false;
  let initialName = request.mode === 'saved' && request.initialName !== undefined ? copilotSessionName(request.initialName) : undefined;
  const lifecycle = copilotSessionLifecycle(() => owner, backend, { connect, stop: stopToken, gate: () => ready() && !project.deletionPending() && !lifetime.deleting() ? 'ready' : 'blocked' });
  async function connect(options: import('../session-lifecycle').ConnectSessionOptions): Promise<void> {
    if (!ready() || project.deletionPending() || !lifetime.current() || !lifetime.available(options) || owner.starting || backend.session && !owner.ended) return;
    const savedId = backend.savedSessionId;
    const conflict = (id: string) => lifetime.conflicts({ kind: 'copilot-sdk', sessionId: id });
    if (savedId && conflict(savedId)) { effects.connection('This ID is already open in another Copilot session. Select that entry or close it before connecting.'); return; }
    // Consume this explicit creation intent before any await; reconnect never replays it.
    const attemptName = savedId === undefined ? initialName : undefined; initialName = undefined;
    owner.starting = true; effects.changed();
    try { await lifecycle.stop(); }
    catch (error) { owner.starting = false; effects.connection(`Could not stop the previous Copilot connection: ${String(error)}`, !!savedId); effects.changed(); return; }
    if (!lifetime.current() || lifetime.closing()) { owner.starting = false; return; }
    effects.retire(); lifecycle.disconnect('Reconnecting Copilot');
    const token = crypto.randomUUID(); owner.token = token; owner.ended = false;
    const valid = () => lifetime.current() && owner.token === token;
    let initialized = false;
    const session: CopilotSession = new CopilotSession(message => transport.send(token, message), {
      transcriptLog: host.transcriptLog,
      publish: message => { if (valid()) effects.publish(message); },
      identified: id => {
        if (!valid()) throw new Error('Copilot connection is no longer owned');
        if (savedId !== undefined && id !== savedId || conflict(id)) throw new Error('Copilot returned a conflicting identity. No draft was migrated or replaced.');
        host.drafts.bindScope(copilotSdkScope(id)); backend.savedSessionId = id; effects.identified();
      },
      changed: () => {
        if (!valid()) return;
        const state = session.state, first = state.messages.find(message => message.role === 'user' && !message.originLabel);
        // Native names are authoritative, even when they match the creation placeholder.
        const name = state.sessionName;
        const title = name || (typeof first?.content === 'string' ? first.content.trim().replace(/\s+/g, ' ').slice(0, 70) : '') || effects.title();
        const next = JSON.stringify([state.busy, state.sessionUnavailable, title]);
        if (next !== signature) { signature = next; effects.changed({ title, clearFailed: !!state.busy, persist: !!lifecycle.identity }); }
      },
      notice: message => { if (valid() && !lifetime.closing()) effects.notice({ id: `copilot:${++sequence}`, operation: 'Copilot', message }); },
      decision: (kind, request, signal) => valid() ? ui.decision(kind, request, signal) : Promise.resolve(undefined),
      commandChoice: (title, choices, signal) => valid() ? ui.commandChoice(title, choices, signal) : Promise.resolve(undefined),
      commandInput: (title, signal) => valid() ? ui.commandInput(title, signal) : Promise.resolve(undefined),
      disconnected: message => {
        if (!valid()) return;
        owner.ended = true; effects.retire(); effects.publish({ type: 'sessionDisconnected' });
        if (!retiring && !lifetime.closing() && !lifetime.deleting() && !effects.hasConnectionOutcome()) effects.connection(`${message}. Your draft and any saved identity remain. Nothing was replayed or replaced by a new session.`, !!lifecycle.identity);
        if (initialized && !lifetime.closing() && !lifetime.reloading() && !lifetime.deleting()) void stopToken(token).catch(error => { if (valid()) effects.connection(`Could not stop Copilot: ${String(error)}`, !!lifecycle.identity); });
        effects.changed();
      },
      completed: (failed, response) => { if (valid()) effects.attention(failed ? 'failed' : 'completed', token, 'Copilot', response); },
    });
    backend.session = session;
    effects.publish({ type: 'sessionReset', composerState: host.drafts.read() }); effects.publish({ type: 'snapshot', state: session.state });
    try {
      const confirmed = await transport.start(token, packet => { if (valid()) session.receive(packet); }, reason => { if (valid()) session.disconnect(reason); });
      if (!valid() || confirmed !== host.project) throw new Error('Native SDK host did not confirm this project');
      await session.initialize(savedId);
      if (valid()) { initialized = true; effects.resolve('connection'); }
    } catch (error) {
      session.disconnect(String(error));
      try { await stopToken(token); } catch (error) { if (valid()) effects.connection(String(error), !!savedId); }
    } finally { if (owner.token === token) { owner.starting = false; if (valid()) effects.changed(); } }
    // Naming is not part of startup success and must not tear down a created session.
    if (initialized && valid() && !owner.ended && !lifetime.closing() && !lifetime.reloading() && !lifetime.deleting() && attemptName !== undefined) {
      void session.rename(attemptName).catch(error => {
        if (valid() && !owner.ended && !lifetime.closing() && !lifetime.reloading() && !lifetime.deleting()) effects.notice({ id: 'rename', operation: 'Name new session',
          message: 'The session was created, but its name could not be confirmed. Use Rename session to try again.', details: String(error) });
      });
    }
  }
  return {
    lifecycle, drafts: { durability: 'persistent' },
    retention: { async check() {
      if (!backend.savedSessionId) return 'absent';
      return await history()?.retention(backend.savedSessionId) ?? 'unknown';
    }, forget() {} },
    conversation: conversationPort(host, () => backend.session, copilotInteraction(text => owner.starting || !backend.session ? 'Copilot is still connecting. Your draft was kept.' : backend.session.validatePrompt(text))),
    configuration: { current: () => backend.session?.configuration },
    actions: { current: () => configurationActions(copilotSessionActions(backend.session), { model: 'model', thinking: 'effort', mode: 'mode', 'context-window': 'context-tier' }), async control() { throw new Error('This Copilot control is no longer available'); } },
    presentation: { snapshot: () => ({ harnessLabel: 'Copilot', badge: 'Copilot', badgeTitle: '', busy: backend.session?.state.busy === true,
      working: backend.session?.state.busy === true, pending: backend.session?.state.busy === true, compacting: false, queuePending: false, destructiveBusy: backend.session?.hasPendingWork === true }) },
    commands: bindSessionCommands(() => backend.session?.slashCommands, () => lifetime.current() && !owner.starting && !owner.ended && !lifetime.closing() && !lifetime.reloading() && !lifetime.deleting()),
    naming: { async rename(name) {
      if (lifecycle.connection !== 'connected' || !backend.session) throw new Error('Resume this Copilot session before renaming it.');
      await backend.session.rename(name);
    } },
    close: savedClose,
    deletion: { current: () => {
      const reference = lifecycle.identity;
      return reference ? { kind: 'saved', reference } : { kind: 'close' };
    } },
    reload: {
      available: () => !!lifecycle.identity,
      reason: () => !lifecycle.identity ? 'Reload session — available after Copilot assigns a saved identity' : lifetime.reloading() ? 'Reloading session…' : 'Reload session',
      detail: 'Reload this conversation with a fresh Copilot process',
      confirmation: 'This interrupts this session’s agent and resumes its saved history. Your draft stays; in-flight work will not continue. Nothing is sent again automatically.',
      needsConfirmation: inputPending => inputPending || !owner.ended && !!backend.session?.hasPendingWork,
      async run() {
        if (!lifecycle.identity) throw new Error('Reload requires a saved Copilot identity');
        retiring = true;
        try {
          await lifecycle.stop();
          effects.retire(); effects.publish({ type: 'sessionDisconnected' });
          lifecycle.disconnect('Session reloaded'); owner.ended = true;
        } finally { retiring = false; }
        await lifecycle.connect({ acceptedAction: true });
      },
    },
    selection: ordinarySelection, references: noReferences,
    interactions: { setActive(active) { if (!active) backend.session?.cancelCommands(); ui.setActive(active); }, dispose: ui.dispose },
  };
}
