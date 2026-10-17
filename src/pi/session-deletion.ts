import type { SessionDeletion } from '../session-deletion';
import type { SessionDeletionSource } from '../session-deletion-operation';

/** Pi retains the native tree transaction, including partial results and quarantine. */
export function piSessionDeletion(deletion: SessionDeletion): SessionDeletionSource {
  return {
    operation(reference) {
      if (!('path' in reference)) return;
      const { path, sessionId } = reference;
      return {
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
