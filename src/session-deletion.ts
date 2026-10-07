import type { DeletionTreeSession } from './deletion-review';
// Pi-specific frontend half of the native app-wide deletion transaction.
export interface DeleteResult { file: string; deleted: boolean; error?: string | null; }
export interface DeletionEvent { id: string; phase: 'begin' | 'lock' | 'check' | 'review' | 'quarantine' | 'complete' | 'release'; files: string[]; results: DeleteResult[]; tree?: DeletionTreeSession[] | null; message?: string | null; pending: boolean; }
export interface DeletionSnapshot { pending: boolean; quarantine: string[]; files: string[]; deleted?: string[]; error?: string | null; }
export interface SessionDeletionReport { file: string; token?: string; title: string; busy: boolean; hasDraft: boolean; }
export interface DeletionPanel {
  file: string;
  lock(locked: boolean): void;
  refresh(): Promise<void>;
  report(): SessionDeletionReport;
  deleted(): void;
  failed(message: string): void;
}
interface Dependencies {
  panels(): DeletionPanel[];
  acknowledge(id: string, sessions: SessionDeletionReport[]): Promise<void>;
  snapshot(): Promise<DeletionSnapshot>;
  run(root: string, sessionId: string): Promise<DeleteResult[]>;
  recover(path: string, sessionId: string): Promise<void>;
  changed(): void;
  deleted?(files: string[]): void;
  loadingReview?(): void;
  review?(id: string, tree: DeletionTreeSession[]): Promise<boolean>;
  confirm?(id: string, confirmed: boolean): Promise<void>;
  cancelReview?(): void;
  error(message: string): void;
}
export class SessionDeletion {
  pending = false;
  private quarantine = new Set<string>();
  private events = Promise.resolve();
  private disposed = false;
  private confirmedDeleted = new Set<string>();
  constructor(private readonly deps: Dependencies) {}
  blocked(file: string | undefined): boolean { return !!file && this.quarantine.has(file); }
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
    if (!snapshot.pending) this.deps.cancelReview?.();
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
      if (event.phase === 'lock' || event.phase === 'check') {
        for (const panel of panels) panel.lock(true);
        const reports = await Promise.all(panels.map(async panel => {
          let failed = false;
          try { await panel.refresh(); } catch { failed = true; }
          const report = panel.report(); return { ...report, busy: failed || report.busy };
        }));
        if (!this.disposed) await this.deps.acknowledge(event.id, reports);
      } else if (event.phase === 'review') {
        const confirmed = await this.deps.review?.(event.id, event.tree || []) ?? false;
        if (!this.disposed) await this.deps.confirm?.(event.id, confirmed);
      } else if (event.phase === 'quarantine') {
        event.files.forEach(file => this.quarantine.add(file));
      } else if (event.phase === 'complete' || event.phase === 'release') {
        this.pending = event.pending;
        if (event.phase === 'complete') {
          event.files.forEach(file => this.quarantine.add(file));
          for (const panel of this.deps.panels().filter(panel => event.files.includes(panel.file))) {
            const result = event.results.find(result => result.file === panel.file);
            if (!result?.deleted) panel.failed(`${result?.error || event.message || 'Deletion did not complete.'} This session is inactive. Explicitly choose Resume session to validate and recover it; nothing will be replayed.`);
          }
          this.removeConfirmed(event.results.filter(result => result.deleted).map(result => result.file));
        }
        for (const panel of this.deps.panels().filter(panel => event.files.includes(panel.file))) panel.lock(false);
        this.pending = event.pending;
        if (event.message) this.deps.error(event.message);
        if (!event.pending) this.deps.cancelReview?.();
      }
      this.deps.changed();
    });
    this.events = task.catch(error => { if (!this.disposed) this.deps.error(String(error)); });
    return this.events;
  }
  async run(file: string, sessionId: string): Promise<void> {
    if (this.pending || this.disposed || this.blocked(file)) return;
    this.pending = true; this.deps.changed();
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
      this.deps.cancelReview?.();
      if (!this.disposed) {
        try {
          const snapshot = await this.deps.snapshot();
          this.load({ ...snapshot, deleted: [...snapshot.deleted || [], ...results.filter(result => result.deleted).map(result => result.file)] });
        }
        catch (error) { this.deps.error(`Could not verify deletion-worker shutdown: ${error}. Session launches remain blocked.`); }
        this.removeConfirmed(results.filter(result => result.deleted).map(result => result.file));
        this.deps.changed();
      }
    }
  }
  async recover(file: string, sessionId: string): Promise<void> {
    if (this.pending || this.disposed) throw new Error('Deletion is pending; recovery is blocked.');
    await this.deps.recover(file, sessionId);
    this.quarantine.delete(file); this.confirmedDeleted.delete(file); this.deps.changed();
  }
  dispose(): void { this.disposed = true; this.deps.cancelReview?.(); }
}
