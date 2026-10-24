import type { SessionDeletionContext, SessionDeletionSource } from '../session-deletion-operation';
import type { CopilotSessionHistory } from './session-history';
import { copilotSdkScope } from './session-lifecycle';
export type CopilotDeletionHistory = Pick<CopilotSessionHistory, 'supportsDeletion' | 'validateDeletion' | 'deleteSession'>;
export function copilotSessionDeletion(history: () => CopilotDeletionHistory | undefined, context: SessionDeletionContext): SessionDeletionSource {
  return {
    pending: false,
    operation(reference, title) {
      if (!('kind' in reference) || reference.kind !== 'copilot-sdk') return;
      const { sessionId } = reference, scope = copilotSdkScope(sessionId);
      const target = { key: scope, draftScope: scope };
      return {
        target, label: 'Delete session…', detail: 'Review permanent removal of this Copilot session and artifacts',
        get supported() { return !!history()?.supportsDeletion; },
        get unavailableReason() { return history()?.supportsDeletion ? undefined : 'Connect Copilot history before deletion. Close keeps history and drafts.'; },
        available: () => !!history()?.supportsDeletion,
        async run() {
          context.signal.throwIfAborted();
          const source = history();
          if (!source?.supportsDeletion) throw new Error('Copilot history is unavailable. Nothing was deleted.');
          context.lock([target], false);
          if (!await context.review({ id: sessionId, title: 'Delete Copilot session',
            description: 'Stops this session’s Nimrod-owned agent and permanently removes its Copilot history and artifacts, Nimrod draft and references. Other sessions are not included. This cannot be undone. External applications are not coordinated.',
            sessions: [{ key: scope, title }] })) return;
          context.signal.throwIfAborted();
          await source.validateDeletion(sessionId);
          context.signal.throwIfAborted();
          context.lock([target], true);
          await context.stop([target]);
          context.signal.throwIfAborted();
          context.progress('deleting');
          await source.deleteSession(sessionId);
          context.removed([target]);
        },
      };
    },
  };
}
