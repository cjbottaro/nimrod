import type { SessionDeletionSource } from '../session-deletion-operation';
import { codexScope } from './session-lifecycle';
/** Codex deletion is recursive, so single-row deletion must remain explicitly unavailable. */
export function codexSessionDeletion(): SessionDeletionSource {
  return {
    pending: false,
    operation(reference) {
      if (!('kind' in reference) || reference.kind !== 'codex') return;
      const scope = codexScope(reference.sessionId);
      const reason = 'Codex permanently deletes spawned descendant threads too. Deletion is unavailable until Nimrod can review that complete scope. Close keeps history and drafts.';
      return { target: { key: scope, draftScope: scope }, label: 'Delete Codex thread tree…', detail: reason,
        supported: false, unavailableReason: reason, available: () => false,
        async run() { throw new Error(reason); },
      };
    },
  };
}
