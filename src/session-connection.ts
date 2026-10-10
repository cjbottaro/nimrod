export type ConnectionEligibility = 'connected' | 'connectable' | 'blocked' | 'unavailable';

interface Dependencies<T> {
  selected(): T | undefined;
  eligibility(target: T): ConnectionEligibility;
  connect(target: T): Promise<void>;
  failed(target: T, error: unknown): void;
}

/** Selected-session connection effects, independent of navigation intent and feature gates.
 * The shell supplies authoritative eligibility and the Pi launch operation. Barrier changes
 * reconsider only a deferred selection, never retry a failed or disconnected process.
 */
export class SessionConnection<T> {
  private deferred: T | undefined;
  private inFlight = new Set<T>();

  constructor(private readonly deps: Dependencies<T>) {}

  /** Every selection boundary requests connection; newer selections supersede deferrals. */
  request(): void {
    this.deferred = undefined;
    const target = this.deps.selected();
    if (target === undefined || this.inFlight.has(target)) return;
    const eligibility = this.deps.eligibility(target);
    if (eligibility === 'blocked') this.deferred = target;
    else if (eligibility === 'connectable') void this.start(target);
  }

  /** Feature gates signal changes here without knowing selection or connection policy. */
  barriersChanged(): void {
    if (this.deferred === undefined) return;
    if (this.deps.selected() !== this.deferred) { this.deferred = undefined; return; }
    this.request();
  }

  private async start(target: T): Promise<void> {
    this.inFlight.add(target);
    try { await this.deps.connect(target); }
    catch (error) { this.deps.failed(target, error); }
    finally { this.inFlight.delete(target); }
  }
}
