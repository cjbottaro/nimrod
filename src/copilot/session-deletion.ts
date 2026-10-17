import type { SessionDeletionContext, SessionDeletionSource } from '../session-deletion-operation';
import type { CopilotSessionHistory } from './session-history';
import { copilotSdkScope } from './session-lifecycle';
export function copilotSessionDeletion(history: () => CopilotSessionHistory | undefined, context: SessionDeletionContext, legacyOpen: (id: string) => boolean = () => false): SessionDeletionSource {
  return {
    pending: false,
    operation(reference, title) {
      if (!('kind' in reference) || reference.kind !== 'copilot-sdk') return;
      const { sessionId } = reference, scope = copilotSdkScope(sessionId);
      const target = { key: scope, draftScope: scope };
      return {
        target, label: 'Delete session…', detail: 'Review permanent removal of this Copilot session and artifacts',
        get supported() { return !!history()?.supportsDeletion; },
        get unavailableReason() { return legacyOpen(sessionId) ? 'Close the legacy ACP representation of this ID before SDK deletion. Its separate draft is not migrated or removed.' : history()?.supportsDeletion ? undefined : 'Connect Copilot history before deletion. Close keeps history and drafts.'; },
        available: () => !!history()?.supportsDeletion && !legacyOpen(sessionId),
        async run() {
          context.signal.throwIfAborted();
          const source = history();
          if (!source?.supportsDeletion || legacyOpen(sessionId)) throw new Error('Copilot history is unavailable or this ID has an open legacy ACP representation. Nothing was deleted.');
          context.lock([target], false);
          if (!await context.review({ id: sessionId, title: 'Delete Copilot session',
            description: 'Stops this session’s Nimrod-owned agent and permanently removes its Copilot history and artifacts, Nimrod draft and references. Other sessions are not included. This cannot be undone. External applications are not coordinated.',
            sessions: [{ file: sessionId, title }] })) return;
          context.signal.throwIfAborted();
          await source.validateDeletion(sessionId);
          context.signal.throwIfAborted();
          context.lock([target], true);
          await context.stop([target]);
          context.signal.throwIfAborted();
          if (legacyOpen(sessionId)) throw new Error('A legacy ACP representation opened during deletion review. Nothing was deleted.');
          context.progress('deleting');
          await source.deleteSession(sessionId);
          context.removed([target]);
        },
      };
    },
  };
}
