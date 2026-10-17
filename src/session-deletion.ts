import type { DeletionTreeSession } from './deletion-review';
// Pi-specific frontend half of the native app-wide deletion transaction.
export interface DeleteResult { file: string; deleted: boolean; error?: string | null; }
export interface DeletionEvent { id: string; phase: 'begin' | 'lock' | 'check' | 'review' | 'quarantine' | 'removing' | 'complete' | 'release'; files: string[]; results: DeleteResult[]; tree?: DeletionTreeSession[] | null; message?: string | null; pending: boolean; }
export interface DeletionSnapshot { pending: boolean; quarantine: string[]; files: string[]; deleted?: string[]; error?: string | null; }
export interface SessionDeletionReport { file: string; token?: string; title: string; busy: boolean; hasDraft: boolean; }
export interface DeletionPanel {
  file: string;
  lock(locked: boolean): void;
  executionStarted?(): void;
  report(): SessionDeletionReport;
  deleted(): void;
  failed(message: string): void;
}
export interface SessionDeletionDependencies {
  panels(): DeletionPanel[];
  acknowledge(id: string, sessions: SessionDeletionReport[]): Promise<void>;
  snapshot(): Promise<DeletionSnapshot>;
  run(root: string, sessionId: string): Promise<DeleteResult[]>;
  recover(path: string, sessionId: string): Promise<void>;
  changed(): void;
  deleted?(files: string[]): void;
  recovered?(file: string): void;
  loadingReview?(): void;
  review?(id: string, tree: DeletionTreeSession[]): Promise<boolean>;
  confirm?(id: string, confirmed: boolean): Promise<void>;
  cancelReview?(): void;
  progressReview?(phase: 'stopping' | 'deleting'): void;
  error(message: string): void;
}
export class SessionDeletion {
  pending = false;
  private quarantine = new Set<string>();
  private lockedFiles = new Set<string>();
  private stateInvalid = false;
  private events = Promise.resolve();
  private disposed = false;
  private runningHere = false;
  private confirmedDeleted = new Set<string>();
  constructor(private readonly deps: SessionDeletionDependencies) {}
  blocked(file: string | undefined): boolean { return !!file && (this.stateInvalid || this.quarantine.has(file)); }
  locked(file: string | undefined): boolean { return !!file && this.lockedFiles.has(file); }
  removed(file: string): boolean { return this.confirmedDeleted.has(file); }
  private removeConfirmed(files: string[]): void {
    const fresh = [...new Set(files)].filter(file => !this.confirmedDeleted.has(file));
    if (!fresh.length) return;
    fresh.forEach(file => this.confirmedDeleted.add(file));
    if (this.deps.deleted) this.deps.deleted(fresh);
    else for (const panel of this.deps.panels()) if (fresh.includes(panel.file)) panel.deleted();
  }
  load(snapshot: DeletionSnapshot): void {
    if (this.disposed) return;
    this.pending = snapshot.pending; this.quarantine = new Set(snapshot.quarantine);
    this.stateInvalid = !!snapshot.error;
    this.lockedFiles = new Set(snapshot.pending ? snapshot.files : []);
    if (!snapshot.pending && !this.runningHere) this.deps.cancelReview?.();
    if (snapshot.error) this.deps.error(snapshot.error);
    const successful = new Set(snapshot.deleted || []);
    for (const panel of this.deps.panels().filter(panel => !successful.has(panel.file))) {
      panel.lock(snapshot.files.includes(panel.file) && snapshot.pending);
      if (!snapshot.pending && this.blocked(panel.file)) panel.failed('This session is quarantined after deletion. Explicitly choose Resume session to validate and recover it; nothing will be replayed.');
    }
    this.removeConfirmed([...successful]);
    this.deps.changed();
  }
  handle(event: DeletionEvent): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (event.pending) { this.pending = true; this.deps.changed(); }
    const task = this.events.then(async () => {
      if (this.disposed) return;
      const panels = this.deps.panels().filter(panel => event.files.includes(panel.file));
      if (['lock', 'check', 'review', 'quarantine', 'removing'].includes(event.phase)) event.files.forEach(file => this.lockedFiles.add(file));
      if (event.phase === 'lock' || event.phase === 'check') {
        for (const panel of panels) panel.lock(true);
        // Owned shutdown is native, not gated on Pi responding to get_state.
        const reports = panels.map(panel => panel.report());
        if (!this.disposed) await this.deps.acknowledge(event.id, reports);
      } else if (event.phase === 'review') {
        const confirmed = await this.deps.review?.(event.id, event.tree || []) ?? false;
        if (!this.disposed) await this.deps.confirm?.(event.id, confirmed);
      } else if (event.phase === 'quarantine') {
        event.files.forEach(file => this.quarantine.add(file));
        for (const panel of panels) { panel.lock(true); panel.executionStarted?.(); }
        this.deps.progressReview?.('stopping');
      } else if (event.phase === 'removing') {
        this.deps.progressReview?.('deleting');
      } else if (event.phase === 'complete' || event.phase === 'release') {
        this.pending = event.pending;
        if (event.phase === 'complete') {
          event.files.forEach(file => this.quarantine.add(file));
          for (const panel of this.deps.panels().filter(panel => event.files.includes(panel.file))) {
            const result = event.results.find(result => result.file === panel.file);
            if (!result?.deleted) panel.failed(`${result?.error || event.message || 'Deletion did not complete.'} This session remains guarded. Explicitly choose Resume session to validate and recover it; nothing will be replayed.`);
          }
          this.removeConfirmed(event.results.filter(result => result.deleted).map(result => result.file));
        }
        for (const panel of this.deps.panels().filter(panel => event.files.includes(panel.file))) panel.lock(false);
        this.pending = event.pending;
        if (!event.pending) this.lockedFiles.clear();
        if (event.message) this.deps.error(event.message);
        if (!event.pending && !this.runningHere) this.deps.cancelReview?.();
      }
      this.deps.changed();
    });
    this.events = task.catch(error => { if (!this.disposed) this.deps.error(String(error)); });
    return this.events;
  }
  async run(file: string, sessionId: string): Promise<void> {
    if (this.pending || this.runningHere || this.disposed || this.blocked(file)) return;
    this.pending = true; this.runningHere = true; this.deps.changed();
    this.deps.loadingReview?.();
    let results: DeleteResult[] = [];
    try {
      results = await this.deps.run(file, sessionId);
      // IPC results are authoritative too: do not depend on a separately
      // scheduled event arriving before a snapshot (or arriving at all).
      await this.events;
    }
    catch (error) { if (!this.disposed) this.deps.error(String(error)); }
    finally {
      // Native failures can still have emitted authoritative partial results.
      // Drain queued completion before applying the fallback snapshot on either path.
      await this.events;
      if (!this.disposed) {
        try {
          const snapshot = await this.deps.snapshot();
          this.load({ ...snapshot, deleted: [...snapshot.deleted || [], ...results.filter(result => result.deleted).map(result => result.file)] });
        }
        catch (error) { this.deps.error(`Could not verify deletion state: ${error}. Affected sessions remain guarded until deletion state is verified.`); }
        this.removeConfirmed(results.filter(result => result.deleted).map(result => result.file));
        this.deps.changed();
      }
      this.runningHere = false;
      this.deps.cancelReview?.();
    }
  }
  async recover(file: string, sessionId: string): Promise<void> {
    if (this.disposed || this.stateInvalid || this.locked(file)) throw new Error('This session is locked for deletion or deletion state is invalid; recovery is blocked.');
    await this.deps.recover(file, sessionId);
    this.quarantine.delete(file); this.confirmedDeleted.delete(file); this.deps.recovered?.(file); this.deps.changed();
  }
  dispose(): void { this.disposed = true; this.deps.cancelReview?.(); }
}
