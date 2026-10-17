import { SessionDeletion, type SessionDeletionDependencies } from '../session-deletion';
import type { SessionDeletionContext, SessionDeletionSource, SessionDeletionTarget } from '../session-deletion-operation';

/** Pi retains the native tree transaction, including partial results and quarantine. */
export function piSessionDeletion(
  host: Pick<SessionDeletionDependencies, 'panels' | 'acknowledge' | 'snapshot' | 'run' | 'recover' | 'confirm'>,
  context: SessionDeletionContext,
): SessionDeletionSource & { transaction: SessionDeletion } {
  const target = (path: string): SessionDeletionTarget => ({ key: path, draftScope: `file:${path}` });
  const deletion = new SessionDeletion({
    ...host,
    changed: context.changed,
    deleted: files => context.removed(files.map(target)),
    recovered: context.recovered,
    loadingReview: context.loadingReview,
    review: (id, sessions) => context.review({ id, sessions }),
    cancelReview: context.closeReview,
    progressReview: context.progress,
    error: context.error,
  });
  return {
    transaction: deletion,
    get pending() { return deletion.pending; },
    dispose: () => deletion.dispose(),
    operation(reference) {
      if (!('path' in reference)) return;
      const { path, sessionId } = reference;
      return {
        target: target(path),
        supported: true,
        label: 'Delete session tree…',
        detail: 'Review removal of this saved session and its descendants',
        get unavailableReason() {
          return deletion.blocked(path) ? 'recover through Resume session first'
            : deletion.removed(path) ? 'session was deleted'
            : deletion.pending ? 'deletion pending' : undefined;
        },
        available: () => !deletion.pending && !deletion.blocked(path) && !deletion.removed(path),
        async run() {
          if (deletion.pending || deletion.blocked(path) || deletion.removed(path))
            throw new Error('Session deletion is unavailable. Finish the current deletion or recover this session through Resume session.');
          await deletion.run(path, sessionId);
        },
      };
    },
  };
}
