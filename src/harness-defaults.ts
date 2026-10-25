import type { ConversationInteraction } from './conversation-view-host';
import type { HarnessAction, HarnessActionMetadata, HarnessHistory, HarnessSavedSessions, SessionClosePolicy, SessionInteractions, SessionRestart, SessionSelectionPolicy } from './harness-contract';
import type { HarnessSessionHost } from './harness-host';
import type { SessionDeletionSource } from './session-deletion-operation';
import { savedDraftScope } from './draft-scope';
import { keyboardSubmissionMode } from './pi/composer-dom';
import { newlineHint, sendHint } from './composer-hints';

export const noInteractions: SessionInteractions = Object.freeze({ setActive() {}, dispose() {} });
export const noProjectActions: import('./harness-contract').HarnessProject['actions'] = Object.freeze({ current: () => [] });
export const noConfiguration = Object.freeze({ current: () => undefined });
export const noReferences = Object.freeze({ file: () => undefined });
export const noHistory = (): HarnessHistory => ({ source: () => undefined, associate() {}, async dispose() {} });
export const noDeletion = (): SessionDeletionSource => ({ pending: false, operation: () => undefined });
export const unsupportedRestart = (reason: string): SessionRestart => ({ supported: false, reason });
export const explicitSelection: SessionSelectionPolicy = { deferRestored: true,
  releasesDeferral: intent => intent === 'explicit' || intent === 'row' || intent === 'notification' };
export const ordinarySelection: SessionSelectionPolicy = { deferRestored: false, releasesDeferral: intent => intent !== 'startup' };
export const savedClose: SessionClosePolicy = { alwaysConfirm: false, label: 'Close session',
  message: 'This stops only this session’s agent. Written history and your draft remain; queued and in-flight work will not continue.' };
export const temporaryClose: SessionClosePolicy = { alwaysConfirm: true, label: 'Close temporary session',
  message: 'This stops its agent and discards this temporary session, including its draft, queued messages and pop-outs.' };

/** Generic readable input, not guessed Pi commands, queues or steering semantics. */
export function genericInteraction(label: string): ConversationInteraction {
  return { label, commands: () => [], keyboardMode: event => keyboardSubmissionMode(event, false),
    composer: state => ({ hint: [state.busy ? { text: 'Agent working · Stop to cancel' } : sendHint, newlineHint], stopLabel: `Stop ${label}` }),
    prepare: (text, state) => state.sessionUnavailable || state.busy
      ? { kind: 'reject', error: `${label} is not ready. Your draft was kept.` }
      : text.trimStart().startsWith('/') ? { kind: 'reject', error: 'This integration has not advertised slash commands. Your draft was kept.' }
      : { kind: 'request', message: { type: 'prompt' }, preview: true, navigate: true } };
}

/** Display-only fallback: the adapter must explicitly handle this unsupported
 * outcome. This does not answer, approve, settle or reply to a native request.
 */
export function displayUnsupportedInteraction(host: Pick<HarnessSessionHost, 'effects'>, request: { id: string; title: string; text: string; raw?: unknown }): { kind: 'unsupported' } {
  host.effects.notice({ id: `unsupported:${request.id}`, operation: request.title, message: request.text,
    details: request.raw === undefined ? undefined : JSON.stringify(request.raw, null, 2) });
  return { kind: 'unsupported' };
}

export function noSavedSessions(reason = 'Saved history is not exposed by this integration'): HarnessSavedSessions {
  const unsupported = (): never => { throw new Error(reason); };
  return { accepts: () => false, key: unsupported, draftScope: unsupported,
    prepare: async () => unsupported(), blocked: () => false, locked: () => false,
    removed: () => false, last: () => undefined };
}

export function taggedSavedSessions(id: string): HarnessSavedSessions {
  const scope = (reference: import('./session-lifecycle').SavedSessionIdentity) => {
    if (!('kind' in reference) || reference.kind !== id) throw new Error('Saved identity belongs to another harness');
    return savedDraftScope(id, reference.sessionId);
  };
  return { accepts: reference => 'kind' in reference && reference.kind === id,
    key: scope, draftScope: scope,
    async prepare(reference, metadata) { scope(reference); return { ...metadata, request: { mode: 'resume', reference } }; },
    blocked: () => false, locked: () => false, removed: () => false, last: () => undefined };
}

/** Concrete adapters supply their setting mapping; the shell never guesses it. */
export function configurationActions(actions: readonly (HarnessActionMetadata & { run?: () => Promise<void> })[], settings: Readonly<Record<string, string>>): HarnessAction[] {
  return actions.map(action => {
    const { run, ...metadata } = action;
    if (run) return { ...metadata, run };
    const setting = settings[action.id];
    if (!setting) throw new Error(`Advertised action has no implementation: ${action.id}`);
    return { ...metadata, configurationSetting: setting };
  });
}
