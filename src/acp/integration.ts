import { Channel, invoke } from '@tauri-apps/api/core';
import { AcpSession, type AcpOption } from './session';
import type { AcpProfile } from './profiles';
import { acpSessionLifecycle } from './session-lifecycle';
import { acpInteraction, acpSessionActions } from './view-policy';
import { renderPermissionDetails } from './tool-state';
import type { AcpPermissionRequest } from './client';
import { acpToolPlugin } from './card-plugins';
import { defineHarness } from '../harness-registry';
import { configurationActions, noProjectActions, noHistory, noDeletion, noReferences, noSavedSessions, ordinarySelection, unsupportedRestart } from '../harness-defaults';
import { conversationPort } from '../harness-conversation';
import { ownedProcessStop } from '../session-lifecycle';
import type { HarnessProjectHost, HarnessSessionHost } from '../harness-host';
import type { HarnessSession, SessionRequest } from '../harness-contract';

/** Retained adapter factory, not a product creation/profile UI. */
export function createAcpHarness(profile: AcpProfile) {
  const creation = { action: undefined, defaultMode: 'saved', modes: ['saved'] as const, named: false, title: `${profile.name} session` } satisfies import('../harness-contract').HarnessCreation;
  return defineHarness({ creation, cards: () => acpToolPlugin, id: 'acp', label: profile.name, actions: [{ id: 'harness-acp-options', label: 'ACP session options…', detail: 'Configuration selectors advertised by this ACP agent', context: 'session' }], create(project: HarnessProjectHost) {
    let ready = false;
    return { id: 'acp', label: profile.name,
      creation, actions: noProjectActions,
      initialization: { blocking: false, ready: () => ready, async run() { try { await invoke('stop_acp'); if (project.current()) { ready = true; project.changed(); } }
        catch (error) { project.notice({ id: 'acp-startup', operation: 'Clean up agents', message: String(error) }); } } },
      saved: noSavedSessions('ACP Resume is not exposed; its drafts are memory-only'),
      history: noHistory(), deletion: noDeletion, create: (host: HarnessSessionHost, request: SessionRequest) => createAcpSession(host, request, profile, project, () => ready), dispose() {},
    };
  } });
}
function createAcpSession(host: HarnessSessionHost, _request: SessionRequest, profile: AcpProfile, project: HarnessProjectHost, ready: () => boolean): HarnessSession {
  const { ownership: owner, lifetime, effects } = host, backend: { profile: AcpProfile; session?: AcpSession } = { profile };
  let signature = '', sequence = 0, cancelOption: (() => void) | undefined;
  const stopToken = ownedProcessStop(token => invoke('stop_acp', { token }));
  const lifecycle = acpSessionLifecycle(() => owner, backend, { connect, stop: stopToken, gate: () => ready() && !project.deletionPending() && !lifetime.deleting() ? 'ready' : 'blocked' });
  async function connect(options: import('../session-lifecycle').ConnectSessionOptions) {
    if (!ready() || project.deletionPending() || !lifetime.current() || !lifetime.available(options) || lifetime.restarting() || owner.starting || backend.session && !owner.ended) return;
    owner.starting = true; effects.changed();
    try { await lifecycle.stop(); } catch (error) { owner.starting = false; effects.connection(`Could not stop the previous ACP process: ${error}`); effects.changed(); return; }
    if (!lifetime.current() || lifetime.closing()) { owner.starting = false; return; }
    cancelOption?.(); effects.retire(); lifecycle.disconnect('Reconnecting session');
    const token = crypto.randomUUID(); owner.token = token; owner.ended = false;
    const valid = () => lifetime.current() && owner.token === token;
    let initialized = false;
    const session = new AcpSession(message => invoke('write_acp', { token, message }), {
      transcriptLog: host.transcriptLog, publish: message => { if (valid()) effects.publish(message); },
      changed: () => {
        if (!valid()) return;
        const state = session.state, first = state.messages.find(message => message.role === 'user');
        const title = state.sessionName || (typeof first?.content === 'string' ? first.content.trim().replace(/\s+/g, ' ').slice(0, 70) || `${profile.name} session` : effects.title());
        const next = JSON.stringify([state.busy, state.sessionUnavailable, title]);
        if (next !== signature) { signature = next; effects.changed({ title, clearFailed: state.busy, persist: !!lifecycle.identity }); }
      },
      notice: message => { if (valid() && !lifetime.closing()) effects.notice({ id: `acp:${++sequence}`, operation: 'ACP session', message }); },
      permission: (request, signal) => permission(host, profile.name, request, signal),
      disconnected: message => {
        if (!valid()) return;
        owner.ended = true; cancelOption?.(); effects.retire(); effects.publish({ type: 'sessionDisconnected' });
        if (!lifetime.closing() && !lifetime.deleting() && !effects.hasConnectionOutcome()) effects.connection(`${message}. Nothing was retried. Create a new ACP session explicitly.`);
        if (initialized && !lifetime.closing() && !lifetime.deleting()) void stopToken(token).catch(error => { if (valid()) effects.connection(`Could not stop ACP agent: ${error}`); });
        effects.changed();
      }, completed: (failed, response) => { if (valid()) effects.attention(failed ? 'failed' : 'completed', token, profile.name, response); },
    });
    backend.session = session;
    effects.publish({ type: 'sessionReset', composerState: host.drafts.read() }); effects.publish({ type: 'snapshot', state: session.state });
    const onEvent = new Channel<{ kind: 'rpc'; value: unknown } | { kind: 'disconnected'; message: string }>();
    onEvent.onmessage = packet => { if (valid()) { if (packet.kind === 'rpc') session.receive(packet.value); else session.disconnect(packet.message); } };
    try {
      const confirmed = await invoke<string>('start_acp', { token, config: { cwd: host.project, command: profile.command, args: profile.args, env: profile.env, node: project.runtime().node }, onEvent });
      if (!valid() || confirmed !== host.project) throw new Error('Native ACP host did not confirm this project');
      await session.initialize(host.project); if (valid()) { initialized = true; effects.resolve('connection'); host.ui.focusComposer(); }
    } catch (error) { session.disconnect(error); try { await stopToken(token); } catch (error) { if (valid()) effects.connection(String(error)); } }
    finally { if (owner.token === token) { owner.starting = false; if (valid()) effects.changed(); } }
  }
  async function pick(selectedOption?: AcpOption): Promise<void> {
    const session = backend.session; if (!session || owner.ended || lifetime.closing()) return;
    const request = host.ui.palette.startSelection('ACP session options', () => { void pick(); }, message => effects.notice({ id: `acp-option:${++sequence}`, operation: 'ACP session options', message }));
    if (!request) return;
    cancelOption?.(); cancelOption = request.cancel;
    const valid = () => lifetime.current() && backend.session === session && cancelOption === request.cancel && !owner.ended && !lifetime.closing();
    try {
      if (!selectedOption) {
        const options = session.options.slice(), labels = options.map((option, index) => `${index + 1}. ${option.name}`);
        const choice = await request.choose(labels), selected = choice ? options[labels.indexOf(choice)] : undefined;
        if (selected && valid()) return pick(selected);
        return;
      }
      if (valid()) await session.selectOption(selectedOption, (_title, values, current) => request.choose(values, current));
    } catch (error) { if (valid()) request.error(String(error)); }
    finally { request.finish(); if (cancelOption === request.cancel) cancelOption = undefined; }
  }
  return {
    lifecycle, conversation: conversationPort(host, () => backend.session, acpInteraction(profile.name, text => owner.starting || !backend.session ? 'ACP is still connecting. Your draft was kept.' : backend.session.validatePrompt(text))),
    configuration: { current: () => backend.session?.configuration },
    actions: { current: () => configurationActions(acpSessionActions(backend.session).map(action => action.id === 'harness-acp-options' ? { ...action, run: () => pick() } : action), { model: 'model', thinking: 'effort' }),
      async control(id) { const option = backend.session?.controlOption(id); if (!option) throw new Error('This ACP option is no longer available'); await pick(option); } },
    presentation: { snapshot: () => ({ harnessLabel: `${profile.name} ACP`, badge: `${profile.name} · ACP POC`, badgeTitle: '', busy: backend.session?.state.busy === true,
      working: backend.session?.state.busy === true, pending: backend.session?.client.phase === 'working', compacting: false, queuePending: false, destructiveBusy: backend.session?.state.busy === true }) },
    restart: unsupportedRestart('Restart session — unavailable in the ACP POC'),
    close: { alwaysConfirm: true, label: 'Close ACP session', message: 'This stops this ACP agent and discards Nimrod’s in-memory transcript, draft and pop-outs. Nimrod cannot resume it in this POC. The agent may keep its own saved history; this does not delete it.' },
    selection: ordinarySelection, references: noReferences, interactions: { setActive() {}, dispose() { cancelOption?.(); } }, drafts: { durability: 'memory' },
  };
}
function permission(host: HarnessSessionHost, label: string, request: AcpPermissionRequest, signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted || !host.lifetime.current() || host.lifetime.closing()) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const region = host.ui.document.createElement('section'); region.className = 'acp-permission'; region.setAttribute('role', 'group'); region.setAttribute('aria-label', 'Agent permission request');
    const details = renderPermissionDetails(host.ui.document, request.toolCall); region.append(details);
    const actions = host.ui.document.createElement('div'); actions.className = 'acp-permission-actions'; region.append(actions);
    const raw = details.querySelector('.acp-permission-raw'); if (raw) region.append(raw);
    let settled = false;
    const finish = (choice?: string) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort);
      const restoreFocus = region.contains(host.ui.document.activeElement); region.remove(); host.effects.input(-1); if (restoreFocus) host.ui.focusComposer(); resolve(choice); };
    const abort = () => finish();
    for (const option of request.options) {
      const control = host.ui.document.createElement('button'); control.type = 'button'; control.textContent = option.name;
      control.addEventListener('click', () => { if (!signal.aborted && host.ui.canPresent()) finish(option.optionId); });
      control.dataset.permissionKind = option.kind; actions.append(control);
    }
    const cancel = host.ui.document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel request'; cancel.addEventListener('click', () => finish()); actions.append(cancel);
    signal.addEventListener('abort', abort, { once: true }); host.effects.input(1); host.ui.root.querySelector('[data-pi-id="composer-area"]')!.prepend(region);
    if (host.ownership.token) host.effects.attention('input', host.ownership.token, label, undefined, signal);
  });
}
