// Timing-only, window-local diagnostics. Never pass content, keys, paths or session IDs here.
export const HISTORY_MS = 60_000;
export const AFTER_MS = 5_000;
export const MAX_SAMPLES = 4096;
export const MAX_WORK_SAMPLES = 2048;
export type WorkKind = 'pi-event' | 'state-reduction' | 'timeline-projection' | 'snapshot-delivery'
  | 'shell-session-update' | 'sidebar-row-update' | 'sidebar-reconcile' | 'bookkeeping-prepare' | 'sidebar-rows';
export interface WorkSample {
  atMs: number;
  startedAtMs: number;
  kind: WorkKind;
  parent?: WorkKind;
  active?: boolean;
  count: number;
  totalMs: number;
  selfMs: number;
  maxMs: number;
}
export type PerformanceKind = 'frame-summary' | 'frame-gap' | 'timer-delay' | 'input-delay' | 'input-handler'
  | 'input-next-frame' | 'key-delay' | 'wheel-delay' | 'scroll-delay' | 'composer-layout' | 'transcript-render' | 'snapshot'
  | 'enabled' | 'visible' | 'hidden' | 'focused' | 'blurred' | 'capture';
export interface TimingSample {
  atMs: number;
  kind: PerformanceKind;
  durationMs?: number;
  maxMs?: number;
  count?: number;
  active?: boolean;
}
export interface PerformanceEnvironment {
  userAgent: string;
  fieldSizing: boolean;
  zoom: number;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  appearance?: { backgroundOpacity: number; frostedBackground: boolean; area: 'chrome' | 'window';
    effectiveArea: 'off' | 'chrome' | 'window'; effectiveBackgroundOpacity: number; reducedTransparency: boolean; frostSupported: boolean };
}
export interface PerformanceReport {
  version: 2;
  timeOriginMs: number;
  markerMs: number;
  startMs: number;
  endMs: number;
  droppedSamples: number;
  environment: PerformanceEnvironment;
  samples: TimingSample[];
  work: WorkSample[];
  droppedWorkSamples: number;
  environmentAtStart: PerformanceEnvironment;
}
export interface PerformanceProbe {
  measure<T>(kind: 'input-handler' | 'composer-layout' | 'transcript-render', work: () => T, active?: boolean): T;
  record(kind: 'snapshot', active: boolean): void;
  scope?<T>(kind: WorkKind, work: () => T, active?: boolean): T;
  count?(kind: 'sidebar-rows', amount: number): void;
}

/** Optional instrumentation never defers work or changes return/error semantics. */
export function measureWork<T>(probe: PerformanceProbe | undefined, kind: WorkKind, work: () => T, active?: boolean): T {
  return probe?.scope ? probe.scope(kind, work, active) : work();
}

/** Fixed-capacity ring: no shifting/serialization/disk work on the interaction path. */
export class TimingBuffer<T extends { atMs: number } = TimingSample> {
  private entries: (T | undefined)[];
  constructor(private readonly capacity = MAX_SAMPLES) { this.entries = new Array(capacity); }
  private next = 0;
  private length = 0;
  dropped = 0;
  push(sample: T): void {
    if (this.length === this.capacity) this.dropped++;
    else this.length++;
    this.entries[this.next] = sample;
    this.next = (this.next + 1) % this.capacity;
  }
  read(since: number): T[] {
    const result: T[] = [];
    const start = (this.next - this.length + this.capacity) % this.capacity;
    for (let i = 0; i < this.length; i++) {
      const sample = this.entries[(start + i) % this.capacity]!;
      if (sample.atMs >= since) result.push({ ...sample });
    }
    return result;
  }
}

export function installPerformanceDiagnostics(win: Window, environment: () => PerformanceEnvironment) {
  let enabled = false, disposed = false;
  let history = new TimingBuffer();
  let workHistory = new TimingBuffer<WorkSample>(MAX_WORK_SAMPLES);
  let generation = 0;
  const stack: { kind: WorkKind; active?: boolean; children: number; generation: number }[] = [];
  const buckets = new Map<string, Omit<WorkSample, 'atMs'>>();
  let frame: number | undefined, timer: number | undefined, inputFrame: number | undefined;
  let lastFrame: number | undefined, summaryStart = 0, frames = 0, total = 0, maximum = 0;
  let inputStart: number | undefined;
  let capture: { buffer: TimingBuffer; droppedBefore: number;
    work: TimingBuffer<WorkSample>; droppedWorkBefore: number;
    timer: number; resolve(report: PerformanceReport | null): void } | undefined;
  const now = () => win.performance.now();
  const add = (kind: PerformanceKind, values: Omit<TimingSample, 'atMs' | 'kind'> = {}) => {
    if (!enabled || disposed) return;
    const sample = { atMs: now(), kind, ...values };
    history.push(sample);
    capture?.buffer.push(sample);
  };
  const flushWork = () => {
    if (!enabled || disposed || !buckets.size) return;
    const atMs = now();
    for (const bucket of buckets.values()) {
      const sample = { ...bucket, atMs };
      workHistory.push(sample); capture?.work.push(sample);
    }
    buckets.clear();
  };
  const aggregate = (kind: WorkKind, count: number, duration: number, self: number, startedAtMs: number, active?: boolean, parent?: WorkKind) => {
    if (buckets.size && startedAtMs - buckets.values().next().value!.startedAtMs >= 1000) flushWork();
    const key = `${kind}:${parent ?? 'root'}:${active ?? 'window'}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { kind, startedAtMs, count: 0, totalMs: 0, selfMs: 0, maxMs: 0,
      ...(active === undefined ? {} : { active }), ...(parent === undefined ? {} : { parent }) }; buckets.set(key, bucket); }
    bucket.startedAtMs = Math.min(bucket.startedAtMs, startedAtMs);
    bucket.count += count; bucket.totalMs += duration; bucket.selfMs += self; bucket.maxMs = Math.max(bucket.maxMs, duration);
  };
  const stopSampling = () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    if (timer !== undefined) win.clearTimeout(timer);
    if (inputFrame !== undefined) win.cancelAnimationFrame(inputFrame);
    frame = timer = inputFrame = undefined;
    lastFrame = inputStart = undefined;
    frames = total = maximum = 0;
  };
  const flushFrames = () => {
    if (frames) add('frame-summary', { count: frames, durationMs: total, maxMs: maximum });
    frames = total = maximum = 0;
    summaryStart = now();
    flushWork();
  };
  const startSampling = () => {
    if (!enabled || disposed || win.document.hidden || frame !== undefined) return;
    summaryStart = now();
    const tick = () => {
      frame = undefined;
      if (!enabled || disposed || win.document.hidden) return;
      const time = now();
      if (lastFrame !== undefined) {
        const gap = time - lastFrame;
        frames++; total += gap; maximum = Math.max(maximum, gap);
        if (gap >= 50) add('frame-gap', { durationMs: gap });
      }
      lastFrame = time;
      if (time - summaryStart >= 1000) flushFrames();
      frame = win.requestAnimationFrame(tick);
    };
    const heartbeat = () => {
      const due = now() + 250;
      timer = win.setTimeout(() => {
        timer = undefined;
        if (!enabled || disposed || win.document.hidden) return;
        const delay = Math.max(0, now() - due);
        // Keep normal timer wakes out of the buffer; frame summaries retain baseline cadence.
        if (delay >= 50) add('timer-delay', { durationMs: delay });
        heartbeat();
      }, 250);
    };
    frame = win.requestAnimationFrame(tick);
    heartbeat();
  };
  const eventDelay = (event: Event): number | undefined => {
    // Epoch timestamps appear in older engines. Never mix clock domains silently.
    const stamp = event.timeStamp > 1e12 ? event.timeStamp - win.performance.timeOrigin : event.timeStamp;
    const age = now() - stamp;
    return stamp > 0 && age >= 0 && age < 60_000 ? age : undefined;
  };
  const onInput = (event: Event) => {
    if (!enabled || disposed || win.document.hidden) return;
    const delay = eventDelay(event);
    if (delay !== undefined) add('input-delay', { durationMs: delay });
    if (inputFrame !== undefined) return;
    inputStart = now();
    inputFrame = win.requestAnimationFrame(() => {
      inputFrame = undefined;
      if (inputStart !== undefined) add('input-next-frame', { durationMs: now() - inputStart });
      inputStart = undefined;
    });
  };
  const onKey = (event: Event) => {
    if (!enabled || disposed || win.document.hidden) return;
    const delay = eventDelay(event);
    if (delay !== undefined) add('key-delay', { durationMs: delay });
  };
  const onWheel = (event: Event) => {
    if (!enabled || disposed || win.document.hidden) return;
    const delay = eventDelay(event);
    if (delay !== undefined && delay >= 16) add('wheel-delay', { durationMs: delay });
  };
  const onScroll = (event: Event) => {
    if (!enabled || disposed || win.document.hidden) return;
    const delay = eventDelay(event);
    if (delay !== undefined && delay >= 16) add('scroll-delay', { durationMs: delay });
  };
  const onVisibility = () => {
    if (!enabled) return;
    flushFrames();
    add(win.document.hidden ? 'hidden' : 'visible');
    stopSampling(); startSampling();
  };
  const onFocus = () => add('focused');
  const onBlur = () => add('blurred');
  const cancelCapture = () => {
    if (!capture) return;
    win.clearTimeout(capture.timer);
    capture.resolve(null);
    capture = undefined;
  };
  const probe: PerformanceProbe = {
    measure(kind, work, active) {
      if (!enabled || disposed) return work();
      const start = now();
      try { return work(); }
      finally { add(kind, { durationMs: now() - start, ...(active === undefined ? {} : { active }) }); }
    },
    record: (kind, active) => add(kind, { active }),
    scope(kind, work, active) {
      if (!enabled || disposed) return work();
      const epoch = generation, start = now();
      const previous = stack.at(-1), parent = previous?.generation === epoch ? previous : undefined;
      const span = { kind, active: active ?? parent?.active, children: 0, generation: epoch }; stack.push(span);
      try { return work(); }
      finally {
        stack.pop();
        if (enabled && !disposed && epoch === generation) {
          const duration = Math.max(0, now() - start);
          if (parent) parent.children += duration;
          aggregate(kind, 1, duration, Math.max(0, duration - span.children), start, span.active, parent?.kind);
        }
      }
    },
    count(kind, amount) {
      if (!enabled || disposed || !Number.isSafeInteger(amount) || amount < 0) return;
      const previous = stack.at(-1), parent = previous?.generation === generation ? previous : undefined;
      aggregate(kind, amount, 0, 0, now(), parent?.active, parent?.kind);
    },
  };
  return {
    probe,
    get enabled() { return enabled; },
    get capturing() { return !!capture; },
    setEnabled(value: boolean) {
      if (disposed || value === enabled) return;
      enabled = value; generation++;
      if (!value) {
        stopSampling(); cancelCapture(); history = new TimingBuffer();
        workHistory = new TimingBuffer<WorkSample>(MAX_WORK_SAMPLES); buckets.clear();
        win.document.removeEventListener('input', onInput, true);
        win.document.removeEventListener('keydown', onKey, true);
        win.document.removeEventListener('wheel', onWheel, true);
        win.document.removeEventListener('scroll', onScroll, true);
        win.document.removeEventListener('visibilitychange', onVisibility);
        win.removeEventListener('focus', onFocus); win.removeEventListener('blur', onBlur);
      } else {
        win.document.addEventListener('input', onInput, { capture: true, passive: true });
        win.document.addEventListener('keydown', onKey, { capture: true, passive: true });
        win.document.addEventListener('wheel', onWheel, { capture: true, passive: true });
        win.document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        win.document.addEventListener('visibilitychange', onVisibility);
        win.addEventListener('focus', onFocus); win.addEventListener('blur', onBlur);
        add('enabled'); add(win.document.hidden ? 'hidden' : 'visible'); add(win.document.hasFocus() ? 'focused' : 'blurred');
        startSampling();
      }
    },
    capture(): Promise<PerformanceReport | null> {
      if (!enabled || disposed) return Promise.reject(new Error('Enable performance diagnostics in global Settings → Diagnostics first.'));
      if (capture) return Promise.reject(new Error('A performance capture is already in progress.'));
      flushFrames();
      const marker = now(), start = Math.max(0, marker - HISTORY_MS);
      const environmentAtStart = environment();
      const buffer = new TimingBuffer(), work = new TimingBuffer<WorkSample>(MAX_WORK_SAMPLES);
      for (const sample of history.read(start)) buffer.push(sample);
      for (const sample of workHistory.read(start)) work.push(sample);
      return new Promise(resolve => {
        const timer = win.setTimeout(() => {
          flushFrames();
          const current = capture;
          capture = undefined;
          if (!current) return;
          resolve({ version: 2, timeOriginMs: win.performance.timeOrigin, markerMs: marker,
            startMs: start, endMs: now(), droppedSamples: current.droppedBefore + buffer.dropped,
            environment: environment(), environmentAtStart, samples: buffer.read(start),
            work: work.read(start), droppedWorkSamples: current.droppedWorkBefore + work.dropped });
        }, AFTER_MS);
        capture = { buffer, droppedBefore: history.dropped, work, droppedWorkBefore: workHistory.dropped, timer, resolve };
        add('capture');
      });
    },
    dispose() { this.setEnabled(false); disposed = true; },
  };
}
