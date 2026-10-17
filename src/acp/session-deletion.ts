import type { SessionDeletionOperation, SessionDeletionSource } from '../session-deletion-operation';
import type { SavedSessionIdentity } from '../session-lifecycle';
import { savedSessionKey } from '../session-list';

export interface CopilotDeletionParticipant {
  lock(locked: boolean, executing: boolean): void;
  stop(): Promise<void>;
}
export interface CopilotDeletionHistory {
  readonly supportsDeletion: boolean;
  validateDeletion(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
interface CopilotDeletionHost {
  history(): CopilotDeletionHistory | undefined;
  participants(sessionId: string): readonly CopilotDeletionParticipant[];
  review(sessionId: string, title: string): Promise<boolean>;
  progress(): void;
  closeReview(): void;
  deleted(sessionId: string): void;
  changed(): void;
}

/** ACP deletes one listed identity. It has no Pi lineage or private-file access. */
export class CopilotSessionDeletion implements SessionDeletionSource {
  pending = false;
  private removedKeys = new Set<string>();
  private disposed = false;
  constructor(private host: CopilotDeletionHost) {}

  removed(key: string): boolean { return this.removedKeys.has(key); }

  operation(reference: SavedSessionIdentity, title: string): SessionDeletionOperation | undefined {
    if (!('kind' in reference) || reference.profile !== 'copilot' || !this.host.history()?.supportsDeletion) return;
    const key = savedSessionKey(reference);
    const available = () => !this.disposed && !this.pending && !this.removed(key) && !!this.host.history()?.supportsDeletion;
    return {
      label: 'Delete session…',
      detail: 'Review permanent removal of this saved Copilot session',
      available,
      run: async () => {
        if (!available()) throw new Error('Copilot session deletion is unavailable. Refresh history with an agent that advertises session deletion.');
        const participants = this.host.participants(reference.sessionId);
        this.pending = true;
        try {
          for (const participant of participants) participant.lock(true, false);
          this.host.changed();
          if (!await this.host.review(reference.sessionId, title) || this.disposed) return;
          // Revalidate before stopping writers or dispatching a destructive request.
          const history = this.host.history();
          if (!history?.supportsDeletion) throw new Error('Copilot session deletion is no longer available.');
          await history.validateDeletion(reference.sessionId);
          if (this.disposed) return;
          for (const participant of participants) participant.lock(true, true);
          await Promise.all(participants.map(participant => participant.stop()));
          if (this.disposed) return;
          this.host.progress();
          await history.deleteSession(reference.sessionId);
          this.removedKeys.add(key);
          if (!this.disposed) this.host.deleted(reference.sessionId);
        } finally {
          for (const participant of participants) participant.lock(false, false);
          this.pending = false;
          this.host.closeReview();
          if (!this.disposed) this.host.changed();
        }
      },
    };
  }

  dispose(): void { this.disposed = true; this.host.closeReview(); }
}
