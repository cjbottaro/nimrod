import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { PiSession } from './session';
import { PiTransport, type Packet } from './transport';
import { piSessionLifecycle, type PiSessionLifecycleOwner } from './session-lifecycle';
import { startPiSession, type PiLaunchInfo } from './session-startup';
import { createPiViewProjection, piInteraction, piSessionActions } from './view-policy';
import { presentActivity } from './activity-state';
import { messageChanges, messageVersion } from './conversation-index';
import type { ConversationState } from './types';
import type { SessionFile } from './session-file';
import { PiSessionHistory } from './session-history';
import { piSessionDeletion } from './session-deletion';
import { piInspection } from './integration-inspection';
import type { SessionDeletion, DeletionSnapshot, DeletionEvent } from '../session-deletion';
import { bundledToolRenderer } from './card-plugins/registry';
import { defineHarness } from '../harness-registry';
import { conversationPort } from '../harness-conversation';
import { configurationActions, ordinarySelection, savedClose, temporaryClose } from '../harness-defaults';
import type { HarnessProject, HarnessSession, SessionRequest } from '../harness-contract';
import type { HarnessProjectHost, HarnessSessionHost } from '../harness-host';
import { ownedProcessStop } from '../session-lifecycle';
import { lastUsed } from '../session-recency';

const lastKey = 'nimrod.last-session.v1';
const creation = { action: { id: 'new', label: 'New session', detail: 'Pi · persistent conversation (default harness)' }, defaultMode: 'saved', modes: ['saved', 'temporary'], named: true, title: 'Session' } satisfies import('../harness-contract').HarnessCreation;
export const piHarness = defineHarness({ creation, cards: bundledToolRenderer, id: 'pi', label: 'Pi', actions: [], create: createPiProject });
function createPiProject(host: HarnessProjectHost): HarnessProject {
  let ready = false, transaction: SessionDeletion | undefined, unlisten: UnlistenFn | undefined, disposed = false;
  const history = new PiSessionHistory({ catalog: () => invoke('list_workspace_sessions'), inspect: path => invoke('inspect_workspace_session', { path }),
    open: host.open, removed: path => transaction?.removed(path) ?? false, recency: reference => host.recency().get(reference) });
  const saved: HarnessProject['saved'] = {
    accepts: reference => 'path' in reference,
    key(reference) { if (!('path' in reference)) throw new Error('Pi needs a file identity'); return reference.path; },
    draftScope(reference) { return `file:${this.key(reference)}`; },
    blocked: key => transaction?.blocked(key) ?? false,
    locked: key => transaction?.locked(key) ?? false,
    removed: key => !!key && (transaction?.removed(key) ?? false),
    last() {
      const project = host.project();
      const last = project ? host.drafts().last : host.store.read(lastKey) as { cwd?: unknown; path?: unknown; sessionId?: unknown } | null;
      return last && typeof last.cwd === 'string' && (!project || last.cwd === project) && typeof last.path === 'string' && typeof last.sessionId === 'string'
        ? { project: last.cwd, reference: { path: last.path, sessionId: last.sessionId } } : undefined;
    },
    async prepare(reference, metadata, restoring) {
      if (!('path' in reference)) throw new Error('Pi needs a file identity');
      if (this.removed(reference.path)) throw new Error('The selected session was deleted. Refresh Resume session and choose another session.');
      if (!restoring && this.locked(reference.path)) throw new Error('This session is locked for deletion. Finish or cancel its review before resuming it.');
      if (!restoring && this.blocked(reference.path)) await transaction!.recover(reference.path, reference.sessionId);
      let used = Math.max(lastUsed(metadata.lastUsed), host.recency().get(reference));
      if (!used) {
        try {
          const info = await invoke<SessionFile>('inspect_workspace_session', { path: reference.path });
          if (info.sessionId !== reference.sessionId) throw new Error('The session file was replaced with a different session');
          reference = { path: info.path, sessionId: info.sessionId }; used = Math.max(used, lastUsed(info.lastUserMessageAt));
        } catch (error) { if (!restoring) throw error; }
      }
      if (this.removed(reference.path)) throw new Error('The selected session was deleted. Refresh Resume session and choose another session.');
      if (!restoring && (this.blocked(reference.path) || this.locked(reference.path))) throw new Error('This session is unavailable because of deletion. Finish or cancel its review, or explicitly recover it through Resume session.');
      return { ...metadata, lastUsed: used, request: { mode: 'resume', reference } };
    },
  };
  return {
    id: 'pi', label: 'Pi', creation,
    initialization: { blocking: true, ready: () => ready, async run() { await invoke('stop_pi'); transaction?.load(await invoke<DeletionSnapshot>('deletion_snapshot')); ready = true; } },
    saved, history: { source: () => history, associate() {}, async dispose() { await history.dispose(); } },
    deletion(context) {
      const source = piSessionDeletion({
        panels: () => host.participants().flatMap(panel => {
          const reference = panel.reference; if (!reference || !('path' in reference)) return [];
          return [{ file: reference.path, lock: (locked: boolean) => panel.lock(locked), executionStarted: () => panel.lock(true, true),
            report: () => ({ file: reference.path, token: panel.token, title: panel.title, busy: panel.busy, hasDraft: panel.hasDraft }),
            deleted: () => context.removed([{ key: reference.path, draftScope: `file:${reference.path}` }]), failed: panel.failed }];
        }),
        acknowledge: (id, sessions) => host.current() && host.applicationReady() ? invoke('acknowledge_deletion', { id, sessions }) : Promise.reject(new Error('Project window is not ready to acknowledge deletion')),
        snapshot: () => invoke('deletion_snapshot'), run: (root, sessionId) => invoke('delete_session_tree', { root, sessionId }),
        recover: (path, sessionId) => invoke('recover_deletion_session', { path, sessionId }), confirm: (id, confirmed) => invoke('confirm_session_deletion', { id, confirmed }),
      }, { ...context, removed: targets => {
        const last = host.store.read(lastKey) as { path?: string } | null;
        if (last?.path && targets.some(target => target.key === last.path)) host.store.save(lastKey, null);
        context.removed(targets);
      } });
      transaction = source.transaction;
      void listen<DeletionEvent>('nimrod-session-deletion', event => { void transaction?.handle(event.payload); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } })
        .then(dispose => { if (disposed) dispose(); else unlisten = dispose; }).catch(error => host.notice({ id: 'pi-deletion-listener', operation: 'Observe session deletion', message: String(error) }));
      return source;
    },
    create: (sessionHost, request) => createPiSession(sessionHost, request, host, saved, () => ready),
    dispose() { disposed = true; unlisten?.(); },
  };
}

function shellPresentationChanged(before: ConversationState | undefined, after: ConversationState): boolean {
  if (!before) return true;
  if (before.busy !== after.busy || before.compacting !== after.compacting || before.sessionUnavailable !== after.sessionUnavailable || before.sessionName !== after.sessionName
    || before.extensionStatuses !== after.extensionStatuses || before.queue !== after.queue || before.modelControls !== after.modelControls) return true;
  if (before.messages === after.messages) return false;
  const changes = messageChanges(after.messages);
  if (!changes || changes.previous !== messageVersion(before.messages)) return true;
  return changes.indices.some(index => after.messages[index].role === 'user');
}
function createPiSession(host: HarnessSessionHost, request: SessionRequest, project: HarnessProjectHost, saved: HarnessProject['saved'], ready: () => boolean): HarnessSession {
  const { ownership, lifetime, effects } = host;
  const owner: PiSessionLifecycleOwner = {
    get token() { return ownership.token; }, set token(value) { ownership.token = value; },
    get starting() { return ownership.starting; }, set starting(value) { ownership.starting = value; },
    get ended() { return ownership.ended; }, set ended(value) { ownership.ended = value; },
    mode: request.mode, file: request.mode === 'resume' && 'path' in request.reference ? { ...request.reference, exists: true } : undefined,
  };
  const backend: { session?: PiSession } = {}, projection = createPiViewProjection();
  const stopToken = ownedProcessStop(token => invoke('stop_pi', { token }));
  const inspection = piInspection(host, () => backend.session);
  let sequence = 0, initialName = request.mode !== 'resume' ? request.initialName : undefined;
  const lifecycle = piSessionLifecycle(() => owner, backend, { connect, stop: stopToken,
    gate: () => saved.blocked(owner.file?.path) ? 'unavailable' : saved.locked(owner.file?.path) || lifetime.deleting() || !ready() ? 'blocked' : 'ready' });
  const publish = (message: import('./webview-client').HostMessage) => effects.publish(message.state ? { ...message, state: projection(message.state) } : message);
  async function connect(options: import('../session-lifecycle').ConnectSessionOptions): Promise<void> {
    if (!ready() || !lifetime.current() || !lifetime.available(options) || saved.blocked(owner.file?.path) || saved.locked(owner.file?.path) || owner.starting || backend.session && !owner.ended) return;
    owner.starting = true; effects.changed({ clearFailed: true });
    try { await lifecycle.stop(); }
    catch (error) { owner.starting = false; effects.connection(`Could not stop the previous process: ${error}`); effects.changed(); return; }
    if (!lifetime.current() || lifetime.closing()) { owner.starting = false; return; }
    const token = crypto.randomUUID(); owner.token = token; owner.ended = false;
    const currentToken = () => lifetime.current() && owner.token === token;
    const rpc = new PiTransport(message => invoke('write_pi', { token, message }));
    const mode = owner.file?.exists ? 'resume' : owner.mode;
    const attemptName = initialName; initialName = undefined;
    const config = { cwd: host.project, pi: project.runtime().pi, node: project.runtime().node, mode, sessionName: attemptName,
      sessionFile: mode === 'resume' ? owner.file?.path : undefined, sessionId: mode === 'resume' ? owner.file?.sessionId || undefined : undefined };
    let launchInfo: PiLaunchInfo, identityGeneration = 0, confirmedRaw: { path: string; sessionId: string } | undefined, shellState: ConversationState | undefined, initialized = false;
    const current = new PiSession(rpc, {
      transcriptLog: host.transcriptLog, performance: host.performance, active: lifetime.selected,
      publish: message => { if (currentToken()) publish(message); },
      notice: (message, severity, cause) => { if (currentToken() && !lifetime.closing() && !lifetime.restarting() && !lifetime.deleting()) effects.notice({ id: `pi:${++sequence}`, cause, operation: 'Pi operation', message, severity }); },
      attention: (kind, response) => { if (currentToken()) effects.attention(kind, token, backend.session?.state.sessionName || 'Session', response); },
      choose: (title, options) => host.ui.withDialog(label => host.ui.dialogs.choose(label, options, token), title),
      input: (title, prefill) => host.ui.withDialog(label => host.ui.dialogs.input(label, prefill, token), title),
      confirm: (title, message) => host.ui.withDialog(label => host.ui.dialogs.confirm(label, message, token), title),
      copy: writeText, openLink: href => invoke('open_link', { token, href }),
      disconnected: reason => {
        if (!currentToken()) return;
        owner.ended = true; inspection.cancel(); effects.retire(); effects.publish({ type: 'sessionDisconnected' });
        if (initialized && !lifetime.closing() && !lifetime.deleting()) void stopToken(token).catch(error => { if (currentToken()) effects.connection(`Could not stop Pi: ${error}`); });
        if (!lifetime.closing() && !lifetime.restarting() && !lifetime.deleting() && !effects.hasConnectionOutcome()) effects.connection(`${reason || 'Session disconnected'}. Nothing will be sent automatically.`, !!owner.file?.exists);
        effects.changed();
      },
      identity: async (file, id) => {
        if (!currentToken() || owner.ended) return;
        if (!file || !id) { if (mode === 'resume') throw new Error('Pi did not confirm the selected session identity'); return; }
        if (confirmedRaw && (file !== confirmedRaw.path || id !== confirmedRaw.sessionId)) throw new Error('Pi unexpectedly changed session identity');
        if (confirmedRaw && owner.file?.exists) return;
        const generation = ++identityGeneration;
        const info = await invoke<SessionFile>('session_file_info', { token, path: file, sessionId: id });
        if (!currentToken() || owner.ended || generation !== identityGeneration) return;
        if (launchInfo.session && (!info.exists || info.path !== launchInfo.session.path || info.sessionId !== launchInfo.session.sessionId)) throw new Error('Pi did not resume the exact selected session');
        confirmedRaw = { path: file, sessionId: id }; owner.file = info;
        if (info.exists) {
          try { host.drafts.bind(info.path); host.drafts.remember({ path: info.path, sessionId: info.sessionId, cwd: launchInfo.cwd }); project.store.save(lastKey, { path: info.path, sessionId: info.sessionId, cwd: launchInfo.cwd }); }
          catch (error) { effects.storageFailure(error); }
          effects.identified();
        }
        effects.changed();
      },
      changed: state => {
        if (!currentToken()) return;
        const before = shellState; shellState = state;
        if (!shellPresentationChanged(before, state)) return;
        if (!state.sessionUnavailable) effects.resolve('connection');
        let title = state.sessionName;
        if (!title) {
          const content = state.messages.find(message => message.role === 'user')?.content;
          const preview = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => String(block.text || '')).join(' ') : '';
          title = owner.mode === 'temporary' ? 'Temporary session' : preview.trim().replace(/\s+/g, ' ').slice(0, 70) || (owner.starting ? effects.title() : 'Session');
        }
        effects.changed({ title, clearFailed: !!state.busy && !state.compacting && !state.sessionUnavailable, persist: true });
      },
    }, mode === 'temporary');
    backend.session = current;
    try {
      effects.publish({ type: 'sessionReset', composerState: host.drafts.read() });
      await startPiSession(config, {
        start: receive => { const onEvent = new Channel<Packet>(); onEvent.onmessage = receive; return invoke<PiLaunchInfo>('start_pi', { config, token, onEvent }); },
        currentProject: project.project, current: currentToken, receive: packet => rpc.receive(packet),
        validated: info => { launchInfo = info; if (info.session) { owner.file = info.session; effects.publish({ type: 'sessionReset', composerState: host.drafts.select(`file:${info.session.path}`) }); } },
        initialize: () => current.initialize(attemptName),
      });
      if (currentToken()) { initialized = true; if (!lifetime.restarting()) host.ui.focusComposer(); }
    } catch (error) {
      rpc.disconnect(String(error));
      try { await stopToken(token); } catch (stopError) { if (currentToken()) effects.notice({ id: `stop:${++sequence}`, operation: 'Stop Pi', message: String(stopError) }); }
      if (currentToken()) { effects.connection(String(error), !!owner.file?.exists); owner.ended = true; }
    } finally { if (owner.token === token) { owner.starting = false; if (currentToken()) effects.changed(); } }
  }
  const viewOwner = () => { const current = backend.session; return current && ({ get state() { return projection(current.state); }, messageInput: current.messageInput, handle: (message: Record<string, unknown>) => current.handle(message) }); };
  // Preserve implementation identity across async consumer operations, including reconnect.
  let wrapped: ReturnType<typeof viewOwner>, wrappedSession: PiSession | undefined;
  const readView = () => { if (wrappedSession !== backend.session) { wrappedSession = backend.session; wrapped = viewOwner(); } return wrapped; };
  const snapshot = () => {
    const state = backend.session?.state, subagents = !!state && !!presentActivity(false, '', state.extensionStatuses).subagents;
    const pending = backend.session?.rpc.hasPendingRequest('prompt', 'set_session_name') ?? false;
    return { harnessLabel: 'Pi', badge: owner.mode === 'temporary' ? 'Pi · temporary' : owner.file?.exists ? 'Pi' : 'Pi · awaiting first save', badgeTitle: owner.file?.path || '',
      busy: !!state?.busy, working: !!state?.busy || subagents, pending, compacting: !!state?.compacting, queuePending: !!state?.queue.pendingCount,
      destructiveBusy: pending || !!state && !owner.ended && (!!state.busy || state.compacting || state.modelControls.changing || state.sessionUnavailable || !!state.queue.pendingCount || !!state.queue.steering.length || !!state.queue.followUp.length || subagents) };
  };
  return {
    lifecycle, drafts: { durability: request.mode === 'temporary' ? 'memory' : 'persistent' }, conversation: conversationPort(host, readView, piInteraction), presentation: { snapshot }, configuration: { current: () => backend.session?.configuration },
    actions: { current: () => configurationActions(piSessionActions.map(action => action.id === 'mcp' ? { ...action, run: inspection.run } : action), { model: 'model', thinking: 'effort' }), async control() { throw new Error('This Pi control is no longer available'); } },
    restart: { supported: true, available: () => !!owner.file?.exists && owner.mode !== 'temporary',
      reason: () => saved.blocked(owner.file?.path) ? 'Restart session — recover through Resume session first' : owner.mode === 'temporary' ? 'Restart session — unavailable for temporary sessions' : !owner.file?.exists ? 'Restart session — available after the first save' : lifetime.restarting() ? 'Restarting session…' : 'Restart session',
      detail: 'Restart Pi and retain this conversation', confirmation: 'This interrupts this session’s agent and resumes its saved history. Your draft stays; queued and in-flight work will not continue. Nothing is sent again automatically.',
      needsConfirmation: inputPending => !!backend.session && !owner.ended && (snapshot().busy || snapshot().pending || snapshot().queuePending || inputPending),
      async run() { await lifecycle.stop(); inspection.cancel(); effects.retire(); effects.publish({ type: 'sessionDisconnected' }); lifecycle.disconnect('Session restarted'); owner.ended = true; await lifecycle.connect({ acceptedAction: true }); } },
    close: request.mode === 'temporary' ? temporaryClose : savedClose, selection: ordinarySelection,
    interactions: { setActive() {}, dispose: inspection.cancel }, references: { file: () => owner.mode !== 'temporary' && owner.file?.exists ? { path: owner.file.path, sessionId: owner.file.sessionId } : undefined },
  };
}
