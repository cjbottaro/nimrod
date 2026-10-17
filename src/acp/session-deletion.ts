import type { SessionDeletionContext, SessionDeletionSource } from '../session-deletion-operation';
import { copilotSessionScope } from './profiles';

export interface CopilotDeletionHistory {
  readonly supportsDeletion: boolean;
  validateDeletion(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

/** ACP owns single-session removal; the shared coordinator owns its UI and cleanup. */
export function copilotSessionDeletion(history: () => CopilotDeletionHistory | undefined, context: SessionDeletionContext): SessionDeletionSource {
  return {
    pending: false,
    operation(reference, title) {
      if (!('kind' in reference) || reference.kind !== 'acp' || reference.profile !== 'copilot') return;
      const { sessionId } = reference;
      const scope = copilotSessionScope(sessionId);
      const target = { key: scope, draftScope: scope };
      return {
        target,
        label: 'Delete session…',
        detail: 'Review permanent removal of this saved Copilot session',
        get supported() { return !!history()?.supportsDeletion; },
        get unavailableReason() {
          return history()?.supportsDeletion ? undefined
            : 'Copilot has not advertised saved-session deletion over ACP. Close keeps its history and draft.';
        },
        available: () => !!history()?.supportsDeletion,
        async run() {
          context.signal.throwIfAborted();
          const source = history();
          if (!source?.supportsDeletion) throw new Error('Copilot does not advertise session deletion. Nothing was deleted.');
          context.lock([target], false);
          if (!await context.review({
            id: sessionId, title: 'Delete Copilot session',
            description: 'Stops this session’s Nimrod-owned agent and permanently deletes this saved Copilot session, its draft and references. Other sessions are not included. This cannot be undone.',
            sessions: [{ file: sessionId, title }],
          })) return;
          context.signal.throwIfAborted();
          await source.validateDeletion(sessionId);
          context.signal.throwIfAborted();
          context.lock([target], true);
          await context.stop([target]);
          context.progress('deleting');
          await source.deleteSession(sessionId);
          context.removed([target]);
        },
      };
    },
  };
}
