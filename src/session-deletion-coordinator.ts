import type { SavedSessionIdentity } from './session-lifecycle';
import type { SessionDeletionContext, SessionDeletionOperation, SessionDeletionSource, SessionDeletionTarget } from './session-deletion-operation';

export interface SessionDeletionParticipant {
  lock(locked: boolean, executing: boolean): void;
  stop(): Promise<void>;
}
interface Host {
  canRun(reference: SavedSessionIdentity, target: SessionDeletionTarget): boolean;
  participants(key: string): readonly SessionDeletionParticipant[];
  review: Pick<SessionDeletionContext, 'loadingReview' | 'review' | 'progress' | 'closeReview'>;
  deleted(targets: readonly SessionDeletionTarget[]): void;
  changed(): void;
  error(message: string): void;
}

/** One deletion consumer for every harness; concrete sources retain removal authority. */
export class SessionDeletionCoordinator {
  private sources: SessionDeletionSource[] = [];
  private lifetime = new AbortController();
  private active?: symbol;
  private reviewOwner?: symbol;
  private confirmed = new Set<string>();

  constructor(private host: Host) {}

  get pending(): boolean { return !!this.active || this.sources.some(source => source.pending); }
  removed(key: string): boolean { return this.confirmed.has(key); }

  register<T extends SessionDeletionSource>(create: (context: SessionDeletionContext) => T): T {
    this.lifetime.signal.throwIfAborted();
    const owner = Symbol('deletion source');
    const locks = new Map<string, readonly SessionDeletionParticipant[]>();
    const closeReview = () => {
      if (this.reviewOwner !== owner) return;
      this.reviewOwner = undefined;
      this.host.review.closeReview();
    };
    const context: SessionDeletionContext = {
      signal: this.lifetime.signal,
      changed: () => { if (!this.lifetime.signal.aborted) this.host.changed(); },
      loadingReview: () => {
        if (this.lifetime.signal.aborted || this.reviewOwner && this.reviewOwner !== owner) return;
        this.reviewOwner = owner; this.host.review.loadingReview();
      },
      review: async data => {
        if (this.lifetime.signal.aborted || this.reviewOwner && this.reviewOwner !== owner) return false;
        this.reviewOwner = owner;
        return this.host.review.review(data);
      },
      progress: phase => { if (this.reviewOwner === owner && !this.lifetime.signal.aborted) this.host.review.progress(phase); },
      closeReview,
      lock: (targets, executing) => {
        this.lifetime.signal.throwIfAborted();
        for (const target of targets) {
          if (!locks.has(target.key)) locks.set(target.key, this.host.participants(target.key));
          for (const participant of locks.get(target.key)!) participant.lock(true, executing);
        }
        this.host.changed();
      },
      stop: async targets => {
        this.lifetime.signal.throwIfAborted();
        const participants = targets.flatMap(target => {
          const locked = locks.get(target.key);
          if (!locked) throw new Error('Deletion participants must be locked before stopping.');
          return [...locked];
        });
        const stopped = await Promise.allSettled(participants.map(participant => participant.stop()));
        const failures = stopped.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []);
        if (failures.length) throw new Error(`Could not stop sessions for deletion: ${failures.join('; ')}`);
        this.lifetime.signal.throwIfAborted();
      },
      removed: targets => {
        if (this.lifetime.signal.aborted) return;
        const fresh: SessionDeletionTarget[] = [];
        for (const target of targets) if (!this.confirmed.has(target.key)) {
          this.confirmed.add(target.key); fresh.push(target);
        }
        if (fresh.length) this.host.deleted(fresh);
      },
      recovered: key => { if (!this.lifetime.signal.aborted) this.confirmed.delete(key); },
      error: message => { if (!this.lifetime.signal.aborted) this.host.error(message); },
    };
    const source = create(context);
    const registered: SessionDeletionSource = {
      get pending() { return source.pending; },
      operation: (reference, title) => {
        const saved = { ...reference };
        const operation = source.operation(saved, title);
        if (!operation) return;
        const available = () => !this.lifetime.signal.aborted && !this.pending
          && !this.removed(operation.target.key) && operation.supported && operation.available()
          && this.host.canRun(saved, operation.target);
        return {
          target: operation.target, label: operation.label, detail: operation.detail,
          get supported() { return operation.supported; },
          get unavailableReason() { return operation.unavailableReason; },
          available,
          run: async () => {
            if (!available()) {
              context.error(`${title}: ${operation.unavailableReason || 'Session deletion is currently unavailable.'}`);
              return;
            }
            this.active = owner; context.changed();
            try { await operation.run(); }
            catch (error) { if (!context.signal.aborted) context.error(`${title}: ${error}`); }
            finally {
              for (const participants of locks.values()) for (const participant of participants) participant.lock(false, false);
              locks.clear();
              closeReview();
              if (this.active === owner) this.active = undefined;
              context.changed();
            }
          },
        };
      },
      dispose: () => { closeReview(); source.dispose?.(); },
    };
    this.sources.push(registered);
    return source;
  }

  operation(reference: SavedSessionIdentity, title: string): SessionDeletionOperation | undefined {
    for (const source of this.sources) {
      const operation = source.operation(reference, title);
      if (operation) return operation;
    }
  }

  dispose(): void {
    this.lifetime.abort();
    for (const source of this.sources) source.dispose?.();
  }
}
