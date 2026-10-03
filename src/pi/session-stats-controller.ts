import { JsonRecord } from "./types";
import { NativeSessionStats, nativeSessionStats } from "./session-stats";

const STREAM_REFRESH_INTERVAL_MS = 3_000;

export interface SessionStatsTransport {
  request(type: string, fields?: JsonRecord, timeoutMs?: number): Promise<JsonRecord>;
}

export interface SessionStatsHost {
  onStats(stats: NativeSessionStats | undefined): void;
  onIdentity?(state: unknown): void;
}

export interface SessionStatsScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemScheduler: SessionStatsScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Coalesces native Pi stats reads. Streaming may emit many message_update events,
 * but this sends at most one read every few seconds and never overlaps requests.
 */
export class SessionStatsController {
  private disposed = false;
  private inFlight = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private generation = 0;

  constructor(
    private readonly rpc: SessionStatsTransport,
    private readonly host: SessionStatsHost,
    private readonly scheduler: SessionStatsScheduler = systemScheduler,
    private readonly intervalMs = STREAM_REFRESH_INTERVAL_MS,
  ) {}

  refresh(): void {
    if (this.disposed) return;
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    if (this.timer) return;
    const delay = Math.max(0, this.intervalMs - (this.scheduler.now() - this.lastRequestAt));
    if (delay === 0) this.startRequest();
    else this.timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      this.startRequest();
    }, delay);
  }

  /** Ignore an older request after Pi switches models, then obtain current context metadata. */
  invalidate(): void {
    if (this.disposed) return;
    this.generation++;
    this.host.onStats(undefined);
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending = false;
    if (this.timer) this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private startRequest(): void {
    if (this.disposed || this.inFlight) return;
    this.inFlight = true;
    this.pending = false;
    this.lastRequestAt = this.scheduler.now();
    const generation = this.generation;

    void Promise.all([this.rpc.request("get_session_stats"), this.rpc.request("get_state")])
      .then(([statsResponse, stateResponse]) => {
        if (this.disposed || generation !== this.generation) return;
        this.host.onIdentity?.(stateResponse.data);
        this.host.onStats(nativeSessionStats(statsResponse.data, stateResponse.data));
      })
      .catch(() => {
        // A stats read is best-effort. Never replace the working/activity status on failure.
      })
      .finally(() => {
        this.inFlight = false;
        if (this.disposed || !this.pending) return;
        this.refresh();
      });
  }
}
