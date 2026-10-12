// Timing-only, window-local diagnostics. Never pass content, keys, paths or session IDs here.
export const HISTORY_MS = 60_000;
export const AFTER_MS = 5_000;
export const MAX_SAMPLES = 4096;
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
}
export interface PerformanceReport {
  version: 1;
  timeOriginMs: number;
  markerMs: number;
  startMs: number;
  endMs: number;
  droppedSamples: number;
  environment: PerformanceEnvironment;
  samples: TimingSample[];
}
export interface PerformanceProbe {
  measure<T>(kind: 'input-handler' | 'composer-layout' | 'transcript-render', work: () => T, active?: boolean): T;
  record(kind: 'snapshot', active: boolean): void;
}

/** Fixed-capacity ring: no shifting/serialization/disk work on the interaction path. */
export class TimingBuffer {
  private entries: (TimingSample | undefined)[] = new Array(MAX_SAMPLES);
  private next = 0;
  private length = 0;
  dropped = 0;
  push(sample: TimingSample): void {
    if (this.length === MAX_SAMPLES) this.dropped++;
    else this.length++;
    this.entries[this.next] = sample;
    this.next = (this.next + 1) % MAX_SAMPLES;
  }
  read(since: number): TimingSample[] {
    const result: TimingSample[] = [];
    const start = (this.next - this.length + MAX_SAMPLES) % MAX_SAMPLES;
    for (let i = 0; i < this.length; i++) {
      const sample = this.entries[(start + i) % MAX_SAMPLES]!;
      if (sample.atMs >= since) result.push({ ...sample });
    }
    return result;
  }
}

export function installPerformanceDiagnostics(win: Window, environment: () => PerformanceEnvironment) {
  let enabled = false, disposed = false;
  let history = new TimingBuffer();
  let frame: number | undefined, timer: number | undefined, inputFrame: number | undefined;
  let lastFrame: number | undefined, summaryStart = 0, frames = 0, total = 0, maximum = 0;
  let inputStart: number | undefined;
  let capture: { buffer: TimingBuffer; droppedBefore: number;
    timer: number; resolve(report: PerformanceReport | null): void } | undefined;
  const now = () => win.performance.now();
  const add = (kind: PerformanceKind, values: Omit<TimingSample, 'atMs' | 'kind'> = {}) => {
    if (!enabled || disposed) return;
    const sample = { atMs: now(), kind, ...values };
    history.push(sample);
    capture?.buffer.push(sample);
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
  };
  return {
    probe,
    get enabled() { return enabled; },
    get capturing() { return !!capture; },
    setEnabled(value: boolean) {
      if (disposed || value === enabled) return;
      enabled = value;
      if (!value) {
        stopSampling(); cancelCapture(); history = new TimingBuffer();
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
      if (!enabled || disposed) return Promise.reject(new Error('Enable performance diagnostics in Settings → Diagnostics first.'));
      if (capture) return Promise.reject(new Error('A performance capture is already in progress.'));
      flushFrames();
      const marker = now(), start = Math.max(0, marker - HISTORY_MS);
      const buffer = new TimingBuffer();
      for (const sample of history.read(start)) buffer.push(sample);
      return new Promise(resolve => {
        const timer = win.setTimeout(() => {
          flushFrames();
          const current = capture;
          capture = undefined;
          if (!current) return;
          resolve({ version: 1, timeOriginMs: win.performance.timeOrigin, markerMs: marker,
            startMs: start, endMs: now(), droppedSamples: current.droppedBefore + buffer.dropped,
            environment: environment(), samples: buffer.read(start) });
        }, AFTER_MS);
        capture = { buffer, droppedBefore: history.dropped, timer, resolve };
        add('capture');
      });
    },
    dispose() { this.setEnabled(false); disposed = true; },
  };
}
