import { invoke } from '@tauri-apps/api/core';
import { createCodexConnection } from './connection';
import { sessionName } from '../session-naming';
import { nativeCodexTransport } from './native';
import { CodexSessionHistory, codexHistoryKey } from './session-history';
import { codexSessionDeletion } from './session-deletion';
import { codexInteraction, codexSessionActions } from './view-policy';
import { codexIntegrationUi } from './integration-ui';
import { codexToolPlugin } from './card-plugins';
import { startupAvailability } from '../harness-availability';
import { defineHarness } from '../harness-registry';
import { configurationActions, noProjectActions, noReferences, taggedSavedSessions } from '../harness-defaults';
import { conversationPort } from '../harness-conversation';
import { bindSessionCommands } from '../session-commands';
import { commandInteraction } from '../command-interaction';
import { createMcpInspector, mcpAction } from '../mcp-inspector';
import { codexMcpPage } from './integration-inspection';
import type { HarnessProject, HarnessSession, SessionRequest } from '../harness-contract';
import type { HarnessProjectHost, HarnessSessionHost } from '../harness-host';

const creation = { defaultMode: 'saved', modes: ['saved'], named: true, validateName: sessionName, title: 'Codex session' } satisfies import('../harness-contract').HarnessCreation;
export const codexHarness = defineHarness({ creation, cards: () => codexToolPlugin, id: 'codex', label: 'Codex', actions: [], create: createCodexProject });
function createCodexProject(projectHost: HarnessProjectHost): HarnessProject {
  const availability = startupAvailability(() => invoke<boolean>('codex_runtime_available', { cli: projectHost.runtime().codex }));
  let ready = false, generation = '', history: CodexSessionHistory | undefined;
  const historyError = (error: unknown) => { if (projectHost.current()) projectHost.notice({ id: 'history:codex', operation: 'Read Codex history', message: String(error) }); };
  let initializing: Promise<void> | undefined;
  const initialize = (): Promise<void> => initializing ??= (async () => {
    try {
      const result = await invoke<string>('stop_codex');
      if (!result) throw new Error('Native Codex host did not confirm a new generation');
      if (projectHost.current()) { generation = result; ready = true; source(); projectHost.changed(); }
    } catch (error) { if (projectHost.current()) projectHost.notice({ id: 'codex-startup', operation: 'Initialize Codex', message: String(error) }); }
  })();
  const source = ({ discover = false } = {}): CodexSessionHistory | undefined => {
    const project = projectHost.project();
    if (!availability.available() || !project || !projectHost.current() || !discover && !history && (!ready || projectHost.store.read(codexHistoryKey(project)) !== true)) return;
    const transport = nativeCodexTransport(project, () => ({ cli: projectHost.runtime().codex, generation }), true);
    history ??= new CodexSessionHistory(project, { ...transport, async start(...args) {
      await initialize();
      if (!ready || !projectHost.current()) throw new Error('Codex history host is unavailable');
      return transport.start(...args);
    } }, historyError, {
      transcriptLog: projectHost.transcriptLog,
      interactionFailure: failure => { if (projectHost.current()) projectHost.notice({ id: `history:codex-interaction:${failure.requestId}`, operation: 'Codex catalog interaction',
        message: `Codex catalog requested an interaction Nimrod could not handle (${failure.method}). No answer or approval was supplied.`, details: JSON.stringify(failure, null, 2) }); },
    });
    return history;
  };
  return {
    id: 'codex', label: 'Codex',
    creation, actions: noProjectActions,
    availability,
    initialization: { blocking: false, ready: () => ready && availability.available(), run: initialize },
    saved: taggedSavedSessions('codex'),
    history: { source, associate() { const project = projectHost.project(); if (project) { projectHost.store.save(codexHistoryKey(project), true); source(); } }, async dispose() { await history?.dispose(); } },
    deletion: context => codexSessionDeletion(source, context),
    create: (host, request) => createCodexSession(host, request, projectHost, () => ready && availability.available(), () => generation, source),
    dispose() { void history?.dispose().catch(historyError); },
  };
}
function createCodexSession(host: HarnessSessionHost, request: SessionRequest, project: HarnessProjectHost, ready: () => boolean, generation: () => string, history: () => CodexSessionHistory | undefined): HarnessSession {
  const backend: import('./connection').CodexBackend = { savedSessionId: request.mode === 'resume' ? request.reference.sessionId : undefined };
  const { lifetime, effects, ownership: owner } = host, ui = codexIntegrationUi(host);
  const inspection = createMcpInspector(host, () => backend.session, codexMcpPage);
  let signature = '', sequence = 0, retiring = false;
  const lifecycle = createCodexConnection(() => owner, backend, {
    initialName: request.mode === 'saved' ? request.initialName : undefined,
    project: host.project, transport: nativeCodexTransport(host.project, () => ({ cli: project.runtime().codex, generation: generation() })),
    current: lifetime.current, available: options => ready() && !project.deletionPending() && lifetime.available(options),
    tearingDown: () => lifetime.closing() || lifetime.deleting() || lifetime.reloading(),
    gate: () => ready() && !project.deletionPending() && !lifetime.deleting() ? 'ready' : 'blocked',
    conflicts: id => lifetime.conflicts({ kind: 'codex', sessionId: id }), drafts: host.drafts,
    effects: { changed: effects.changed, identified: effects.identified, retire() { inspection.cancel(); effects.retire(); },
      nameFailed: error => effects.notice({ id: 'rename', operation: 'Name new session',
        message: 'The session was created, but its name could not be confirmed. Use Rename session to try again.', details: String(error) }),
      resolved: issue => effects.resolve(issue === 'cleanup' ? 'codex-cleanup' : 'connection'), hasConnectionOutcome: effects.hasConnectionOutcome,
      failure: failure => {
        if (retiring || lifetime.closing() || lifetime.deleting()) return;
        if (failure.kind === 'cleanup') effects.notice({ id: 'codex-cleanup', operation: 'Stop Codex', message: failure.message, details: failure.details });
        else effects.connection(failure.message, failure.resumable, failure.details);
      } },
    ui: { transcriptLog: host.transcriptLog, publish: effects.publish, commandInteraction: commandInteraction(host),
      changed: state => {
        let title = effects.title();
        if (state.sessionName) title = state.sessionName;
        else if (title === 'Codex session') {
          const user = state.messages.find(row => row.role === 'user');
          const text = typeof user?.content === 'string' ? user.content : Array.isArray(user?.content) ? user.content.map(block => block.text || '').join('') : '';
          if (text.trim()) title = text.trim().replace(/\s+/g, ' ').slice(0, 70);
        }
        const next = JSON.stringify([state.busy, state.sessionUnavailable, title]);
        if (next !== signature) { signature = next; effects.changed({ title, clearFailed: state.busy, persist: !!lifecycle.identity }); }
      },
      approval: ui.approval, question: ui.question, asyncQuestion: ui.asyncQuestion,
      interactionFailure: failure => {
        if (lifetime.closing()) return;
        const guidance = host.transcriptLog.enabled ? 'Transcript debug logging is enabled; inspect it for the raw request.' : 'Enable Transcript debug logs before another attempt to capture the raw request.';
        effects.notice({ id: `codex-interaction:${++sequence}`, operation: 'Codex interaction', message: `Codex requested an interaction Nimrod could not handle (${failure.method}). No answer or approval was supplied. ${guidance}`, details: JSON.stringify(failure, null, 2) });
      },
      notice: message => { if (!lifetime.closing()) effects.notice({ id: `codex:${++sequence}`, operation: 'Codex', message }); },
      completed: (failed, response) => { if (owner.token) effects.attention(failed ? 'failed' : 'completed', owner.token, 'Codex', response); },
    },
  });
  return {
    lifecycle, drafts: { durability: 'persistent' },
    retention: { async check() {
      if (!backend.savedSessionId) return 'absent';
      return await history()?.retention(backend.savedSessionId) ?? 'unknown';
    }, forget() {} },
    conversation: conversationPort(host, () => backend.session, codexInteraction(text => owner.starting || !backend.session ? 'Codex is still connecting. Your draft was kept.' : backend.session.validatePrompt(text))),
    configuration: { current: () => backend.session?.configuration },
    actions: { current: () => configurationActions([...codexSessionActions(backend.session), ...(lifecycle.connection === 'connected' ? [{ ...mcpAction, run: inspection.run }] : [])], { model: 'model', thinking: 'effort' }), async control() { throw new Error('This Codex control is no longer available'); } },
    presentation: { snapshot: () => ({ harnessLabel: 'Codex', badge: 'Codex', badgeTitle: backend.historyConfirmed ? 'Saved Codex history confirmed' : 'Saved Codex history is not yet confirmed; reconnect may be unavailable', busy: backend.session?.state.busy === true,
      working: backend.session?.state.busy === true, pending: backend.session?.state.busy === true, compacting: backend.session?.state.compacting === true, queuePending: false, destructiveBusy: backend.session?.hasPendingWork === true }) },
    deletion: { current: () => {
      const reference = lifecycle.identity;
      // This is a target candidate, not saved-history or connection evidence.
      // The independent catalog owns native existence, lineage and deletion guards.
      return reference ? { kind: 'saved', reference } : { kind: 'close' };
    } },
    reload: {
      available: () => !!lifecycle.identity && backend.historyConfirmed === true,
      reason: () => !lifecycle.identity || !backend.historyConfirmed ? 'Reload session — available after saved Codex history is confirmed' : lifetime.reloading() ? 'Reloading session…' : 'Reload session',
      detail: 'Reconnect and reload this Codex conversation',
      confirmation: 'This reconnects Nimrod to the same Codex thread. Your draft stays; work in the shared daemon may continue. Pending local controls are retired, and nothing is sent again automatically.',
      needsConfirmation: inputPending => inputPending || !owner.ended && !!backend.session?.hasPendingWork,
      async run() {
        if (!lifecycle.identity || !backend.historyConfirmed) throw new Error('Reload requires confirmed saved Codex history');
        retiring = true;
        inspection.cancel();
        try {
          await lifecycle.stop();
          effects.retire(); effects.publish({ type: 'sessionDisconnected' });
          lifecycle.disconnect('Session reloaded'); owner.ended = true;
        } finally { retiring = false; }
        await lifecycle.connect({ acceptedAction: true });
      },
    },
    commands: bindSessionCommands(() => backend.session?.slashCommands, () => lifetime.current() && !owner.starting && !owner.ended && !lifetime.closing() && !lifetime.reloading() && !lifetime.deleting()),
    naming: { async rename(name) {
      if (lifecycle.connection !== 'connected' || !backend.session) throw new Error('Resume this Codex session before renaming it.');
      await backend.session.rename(name);
    } },
    close: { alwaysConfirm: false, label: 'Close session',
      message: 'This disconnects Nimrod from this Codex thread without stopping its shared daemon or active work. Saved history and your draft remain; confirmed-unsaved local state is discarded.' }, interactions: { setActive(active) { if (!active) { backend.session?.slashCommands.cancel(); inspection.cancel(); } ui.setActive(active); }, dispose() { backend.session?.slashCommands.cancel(); inspection.cancel(); ui.dispose(); } }, references: noReferences,
  };
}
