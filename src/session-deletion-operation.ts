import type { SavedSessionIdentity } from './session-lifecycle';
import type { DeletionReviewData } from './deletion-review';

/** Project-local cleanup identity, independent of a harness's wire identity. */
export interface SessionDeletionTarget {
  readonly key: string;
  readonly draftScope: string;
}

/** Delete controls consume a target-bound operation, not a connection lifecycle. */
export interface SessionDeletionOperation {
  readonly target: SessionDeletionTarget;
  readonly label: string;
  readonly detail: string;
  readonly supported: boolean;
  readonly unavailableReason?: string;
  available(): boolean;
  /** Includes review, authoritative removal and reconciliation; cancellation is not success. */
  run(): Promise<void>;
}

export interface SessionDeletionSource {
  /** Integration-owned activity, including transactions initiated in another window. */
  readonly pending: boolean;
  operation(reference: SavedSessionIdentity, title: string): SessionDeletionOperation | undefined;
  dispose?(): void;
}

/** Integration effects are scoped by the shared coordinator, not wired into each UI caller. */
export interface SessionDeletionContext {
  readonly signal: AbortSignal;
  changed(): void;
  loadingReview(): void;
  review(data: DeletionReviewData): Promise<boolean>;
  progress(phase: 'stopping' | 'deleting'): void;
  closeReview(): void;
  lock(targets: readonly SessionDeletionTarget[], executing: boolean): void;
  stop(targets: readonly SessionDeletionTarget[]): Promise<void>;
  removed(targets: readonly SessionDeletionTarget[]): void;
  recovered(key: string): void;
  error(message: string): void;
}
