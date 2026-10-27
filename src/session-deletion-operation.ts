import type { SavedSessionIdentity } from './session-lifecycle';
import type { DeletionReviewData } from './deletion-review';

/** Project-local cleanup identity, independent of a harness's wire identity. */
export interface SessionDeletionTarget {
  readonly key: string;
  readonly draftScope: string;
}

/** A mounted session declares a local-Close or native-deletion candidate. Neither
 * connectivity nor local history-confirmation state is deletion authority: the
 * independent source validates existence/scope and owns the operation's guards.
 */
export type SessionDeletionIntent =
  | { readonly kind: 'close' }
  | { readonly kind: 'saved'; readonly reference: SavedSessionIdentity };

/** Delete controls consume a target-bound operation, not a connection lifecycle.
 * Disconnected targets must not need connect()/Resume to obtain or run one.
 */
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
  /** Reconcile confirmed native removals or a completed explicit local deletion
   * after the adapter established native absence and stopped/fenced owned writers.
   * Never infer this from a failed lookup or ambiguous native mutation.
   */
  removed(targets: readonly SessionDeletionTarget[]): void;
  recovered(key: string): void;
  error(message: string): void;
}
