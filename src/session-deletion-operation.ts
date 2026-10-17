import type { SavedSessionIdentity } from './session-lifecycle';

/** Delete controls consume a target-bound operation, not a connection lifecycle. */
export interface SessionDeletionOperation {
  readonly label: string;
  readonly detail: string;
  readonly unavailableReason?: string;
  available(): boolean;
  /** Includes review, authoritative removal and reconciliation; cancellation is not success. */
  run(): Promise<void>;
}

export interface SessionDeletionSource {
  operation(reference: SavedSessionIdentity, title: string): SessionDeletionOperation | undefined;
}
