import { defineHarness } from '../../src/harness-registry';
import { explicitSelection, noConfiguration, noInteractions, noReferences, savedClose, taggedSavedSessions, unsupportedRestart, displayUnsupportedInteraction } from '../../src/harness-defaults';
import { genericInteraction } from '../../src/harness-defaults';
import { genericCards } from '../../src/card-renderers';
import { savedDraftScope } from '../../src/draft-scope';
import { savedSessionKey } from '../../src/session-list';
import type { ConversationViewState } from '../../src/conversation-view-host';
import type { HarnessCreation, HarnessSession, HarnessProject, SessionRequest } from '../../src/harness-contract';
import type { HarnessProjectHost, HarnessSessionHost } from '../../src/harness-host';
import type { SavedSessionIdentity } from '../../src/session-lifecycle';

/** Protocol/provider-free integration that shared Nimrod has never enumerated. */
const id = 'fixture-harness';
const creation = { action: { id: 'harness-new-fixture', label: 'New fixture session', detail: 'Offline contract integration' }, defaultMode: 'saved', modes: ['saved'], named: false, title: 'Fixture session' } satisfies HarnessCreation;
export const fixtureHarness = defineHarness({ id, label: 'Fixture', creation, cards: genericCards,
  actions: [{ id: 'harness-fixture-question', label: 'Display fixture question', detail: 'Display-only unsupported interaction', context: 'session' }], create: project });
function project(projectHost: HarnessProjectHost): HarnessProject {
  let ready = false, associated = false, pending = false;
  const saved = new Map<string, string>([['saved-fixture', 'Saved fixture session']]);
  return { id, label: 'Fixture', creation,
    initialization: { blocking: false, ready: () => ready, async run() { ready = true; projectHost.changed(); } },
    saved: taggedSavedSessions(id),
    history: { associate() { associated = true; }, source: () => !associated ? undefined : { id, label: 'Fixture',
      async list({ signal }) { signal.throwIfAborted(); return { warnings: [], entries: [...saved].map(([sessionId, title]) => {
        const reference = { kind: id, sessionId }; return { key: savedSessionKey(reference), title, reference, harnessLabel: 'Fixture', keywords: sessionId, open: false, status: 'closed' as const };
      }) }; }, async dispose() {} }, async dispose() {} },
    deletion(context) { return { get pending() { return pending; }, operation(reference, title) {
      if (!('kind' in reference) || reference.kind !== id) return;
      const target = { key: savedDraftScope(id, reference.sessionId), draftScope: savedDraftScope(id, reference.sessionId) };
      return { target, label: 'Delete fixture session…', detail: 'Offline single-session review', supported: true, available: () => !pending && saved.has(reference.sessionId),
        async run() {
          pending = true; context.changed(); context.lock([target], false);
          try {
            if (!await context.review({ id: `fixture:${reference.sessionId}`, sessions: [{ key: target.key, title }] })) return;
            context.progress('stopping'); await context.stop([target]); context.progress('deleting');
            saved.delete(reference.sessionId); context.removed([target]);
          } finally { context.lock([target], false); pending = false; context.changed(); }
        } };
    } }; },
    create(host, request) { return session(host, request, reference => saved.set(reference.sessionId, host.effects.title())); },
    dispose() { ready = false; },
  };
}
function session(host: HarnessSessionHost, request: SessionRequest, remember: (reference: SavedSessionIdentity) => void): HarnessSession {
  let reference: SavedSessionIdentity | undefined = request.mode === 'resume' ? request.reference : undefined;
  let state: ConversationViewState = { messages: [], sessionUnavailable: true, busy: false, status: 'Disconnected' };
  const scope = () => reference && savedDraftScope(id, reference.sessionId);
  const publish = () => { host.effects.publish({ type: 'snapshot', state }); host.effects.changed(); };
  const lifecycle: HarnessSession['lifecycle'] = {
    label: 'Fixture', get identity() { return reference; }, get key() { return scope(); }, get draftScope() { return scope(); },
    get connection() { return host.ownership.starting ? 'connecting' : !host.ownership.ended && !state.sessionUnavailable ? 'connected' : 'disconnected'; },
    eligibility: () => state.sessionUnavailable ? 'connectable' : 'connected',
    async connect() {
      if (!host.lifetime.current() || !host.lifetime.available({ acceptedAction: true }) || !state.sessionUnavailable) return;
      host.ownership.starting = true; host.effects.changed();
      const confirmed = reference ?? { kind: id, sessionId: `new-${host.id}` };
      host.drafts.bindScope(savedDraftScope(id, confirmed.sessionId)); reference = confirmed; remember(reference); host.effects.identified();
      host.ownership.token = `fixture-${host.id}`; host.ownership.ended = false; host.ownership.starting = false;
      state = { ...state, sessionUnavailable: false, status: 'Idle' }; publish();
    },
    async stop() {}, // No native child in this fixture; not a successful no-op for a real runtime.
    disconnect() { host.ownership.ended = true; state = { ...state, sessionUnavailable: true }; publish(); },
  };
  return { lifecycle,
    conversation: { interaction: genericInteraction('Fixture'), get state() { return state; },
      messageInput: { capabilities: () => ({ imageUnavailableReason: 'Fixture is text-only' }), async submit(message) {
        const key = `fixture:${message.id}`;
        host.effects.publish({ type: 'submissionMessage', id: message.id, key });
        state = { ...state, messages: [...(state.messages ?? []), { key, role: 'user', content: message.text },
          { key: `${key}:tool`, role: 'tool', toolCallId: `${key}:tool`, toolName: 'Bash', toolTitle: 'Fixture tool', toolNative: { literal: 'unknown fixture item' }, toolStatus: 'result', output: 'Offline tool output' },
          { key: `${key}:reply`, role: 'assistant', content: 'Offline fixture reply' }] };
        publish(); host.effects.publish({ type: 'submissionReceipt', id: message.id, outcome: 'accepted' });
      } }, async handle(message) { if (message.type !== 'stop') throw new Error('Unsupported fixture operation'); } },
    presentation: { snapshot: () => ({ harnessLabel: 'Fixture', badge: 'Fixture', badgeTitle: '', busy: false, working: false, pending: false, compacting: false, queuePending: false, destructiveBusy: false }) },
    configuration: noConfiguration,
    actions: { current: () => [{ id: 'harness-fixture-question', label: 'Display fixture question', detail: 'Display-only unsupported interaction', async run() {
      displayUnsupportedInteraction(host, { id: 'fixture-question', title: 'Fixture question', text: 'Which option should the agent use?', raw: { choices: ['A', 'B'] } });
    } }], async control() { throw new Error('No fixture configuration controls'); } },
    restart: unsupportedRestart('Fixture restart is unsupported'), close: savedClose, selection: explicitSelection,
    interactions: noInteractions, references: noReferences, drafts: { durability: 'persistent' },
  };
}
