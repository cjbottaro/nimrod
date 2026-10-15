import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { AFTER_MS, MAX_SAMPLES, MAX_WORK_SAMPLES, TimingBuffer, installPerformanceDiagnostics, type PerformanceEnvironment } from '../src/performance-diagnostics';

function fixture(environment?: () => PerformanceEnvironment) {
  const dom = new JSDOM('<textarea></textarea>', { pretendToBeVisual: true });
  const win = dom.window;
  let time = 0, id = 0, hidden = false;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { due: number; run: () => void }>();
  Object.defineProperty(win.performance, 'now', { value: () => time, configurable: true });
  Object.defineProperty(win.document, 'hidden', { get: () => hidden });
  win.requestAnimationFrame = cb => { frames.set(++id, cb); return id; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  win.setTimeout = ((run: () => void, delay: number) => { timers.set(++id, { due: time + delay, run }); return id; }) as typeof win.setTimeout;
  win.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  const diagnostics = installPerformanceDiagnostics(win as unknown as Window, environment ?? (() => ({
    userAgent: 'fixture WebKit', fieldSizing: false, zoom: 125, devicePixelRatio: 2, hardwareConcurrency: 8,
  })));
  const runTimers = () => {
    for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.run(); }
  };
  return { dom, win, diagnostics, frames, timers, runTimers,
    elapse: (ms: number) => { time += ms; },
    frame(ms = 16) { time += ms; for (const [id, cb] of [...frames]) { frames.delete(id); cb(time); } },
    visibility(value: boolean) { hidden = value; win.document.dispatchEvent(new win.Event('visibilitychange')); },
    close() { diagnostics.dispose(); win.close(); },
  };
}

test('disabled diagnostics have no samplers and execute measured work unchanged', async () => {
  const f = fixture();
  try {
    assert.equal(f.diagnostics.enabled, false);
    assert.equal(f.frames.size + f.timers.size, 0);
    assert.equal(f.diagnostics.probe.measure('input-handler', () => 'result'), 'result');
    await assert.rejects(f.diagnostics.capture(), /Enable performance diagnostics/);
    assert.equal(f.frames.size + f.timers.size, 0);
  } finally { f.close(); }
});

test('nested event work aggregates inclusive/self time, context and counters without per-event samples', async () => {
  const f = fixture();
  try {
    f.diagnostics.setEnabled(true);
    const probe = f.diagnostics.probe;
    for (let i = 0; i < 100; i++) probe.scope!('pi-event', () => {
      f.elapse(2);
      probe.scope!('state-reduction', () => f.elapse(5));
      probe.scope!('sidebar-reconcile', () => { probe.count!('sidebar-rows', 24); f.elapse(3); });
      f.elapse(2);
    }, false);
    const pending = f.diagnostics.capture();
    f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    const roots = report.work.filter(sample => sample.kind === 'pi-event');
    assert.equal(roots.reduce((n, sample) => n + sample.count, 0), 100);
    assert.equal(roots.reduce((n, sample) => n + sample.totalMs, 0), 1200);
    assert.equal(roots.reduce((n, sample) => n + sample.selfMs, 0), 400);
    assert.ok(roots.every(sample => sample.maxMs === 12 && sample.active === false && !sample.parent));
    assert.ok(report.work.filter(sample => sample.kind === 'state-reduction').every(sample => sample.parent === 'pi-event' && sample.active === false));
    assert.equal(report.work.filter(sample => sample.kind === 'sidebar-rows').reduce((n, sample) => n + sample.count, 0), 2400);
    assert.ok(report.work.length < 12, 'hundreds of events use only bounded aggregate buckets');
    assert.ok(report.work.every(sample => sample.selfMs <= sample.totalMs && sample.startedAtMs <= sample.atMs));
    assert.equal(report.droppedWorkSamples, 0);
    assert.equal(report.environmentAtStart.zoom, report.environment.zoom);
  } finally { f.close(); }
});

test('work probes preserve exceptions, disabled no-clock work, cancellation and epoch boundaries', async () => {
  const f = fixture();
  try {
    let clocks = 0;
    Object.defineProperty(f.win.performance, 'now', { value: () => { clocks++; return 0; }, configurable: true });
    assert.equal(f.diagnostics.probe.scope!('pi-event', () => 42), 42);
    f.diagnostics.probe.count!('sidebar-rows', 24);
    assert.equal(clocks, 0);
    // Use another fixture for its ordinary fake clock and lifecycle boundaries.
  } finally { f.close(); }
  const g = fixture();
  try {
    g.diagnostics.setEnabled(true);
    assert.throws(() => g.diagnostics.probe.scope!('pi-event', () => { g.elapse(9); throw new Error('unchanged'); }), /unchanged/);
    const pending = g.diagnostics.capture(); g.elapse(AFTER_MS); g.runTimers();
    assert.equal((await pending)!.work.find(sample => sample.kind === 'pi-event')!.maxMs, 9);
    g.diagnostics.probe.scope!('pi-event', () => { g.diagnostics.setEnabled(false); g.diagnostics.setEnabled(true); });
    const next = g.diagnostics.capture(); g.elapse(AFTER_MS); g.runTimers();
    assert.equal((await next)!.work.length, 0, 'retired in-flight spans cannot enter the new history');
  } finally { g.close(); }
});

test('appearance snapshots distinguish capture marker/end; work overwrite counts remain explicit', async () => {
  let opacity = 85;
  const f = fixture(() => ({ userAgent: 'fixture', fieldSizing: true, zoom: 125, devicePixelRatio: 2, hardwareConcurrency: 8,
    appearance: { backgroundOpacity: opacity, frostedBackground: true, area: 'window', effectiveArea: opacity < 100 ? 'window' : 'off',
      effectiveBackgroundOpacity: opacity, reducedTransparency: false, frostSupported: true } }));
  try {
    f.diagnostics.setEnabled(true);
    for (let i = 0; i < MAX_WORK_SAMPLES + 2; i++) {
      f.elapse(1001); f.diagnostics.probe.scope!('pi-event', () => f.elapse(1), false);
    }
    const pending = f.diagnostics.capture(); opacity = 100;
    f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    assert.equal(report.environmentAtStart.appearance!.backgroundOpacity, 85);
    assert.equal(report.environment.appearance!.effectiveArea, 'off');
    assert.ok(report.droppedWorkSamples > 0);
    assert.ok(report.work.length <= MAX_WORK_SAMPLES);
    assert.ok(report.work.every(sample => sample.atMs >= report.startMs));
    assert.doesNotMatch(JSON.stringify(report.work), /userAgent|appearance|project|sessionId/);
  } finally { f.close(); }
});

test('fixed-capacity timing ring keeps chronological samples and reports overwritten entries', () => {
  const buffer = new TimingBuffer();
  for (let i = 0; i < MAX_SAMPLES + 10; i++) buffer.push({ atMs: i, kind: 'snapshot', active: false });
  const samples = buffer.read(0);
  assert.equal(samples.length, MAX_SAMPLES); assert.equal(samples[0].atMs, 10);
  assert.equal(samples.at(-1)!.atMs, MAX_SAMPLES + 9); assert.equal(buffer.dropped, 10);
  assert.equal(buffer.read(MAX_SAMPLES).length, 10);
});

test('capture freezes the preceding window and retains post-marker work, baseline cadence and stalls', async () => {
  const f = fixture();
  try {
    f.diagnostics.setEnabled(true);
    f.diagnostics.probe.record('snapshot', false);
    f.frame(16); f.frame(16); f.frame(100);
    f.elapse(1000); f.runTimers();
    f.diagnostics.probe.measure('composer-layout', () => f.elapse(12), true);
    const pending = f.diagnostics.capture();
    await assert.rejects(f.diagnostics.capture(), /already in progress/);
    assert.equal(f.diagnostics.capturing, true);
    f.diagnostics.probe.measure('transcript-render', () => f.elapse(20), false);
    f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    assert.equal(report.version, 2); assert.equal(report.environment.fieldSizing, false);
    assert.ok(report.samples.some(s => s.kind === 'frame-gap' && s.durationMs === 100));
    assert.ok(report.samples.some(s => s.kind === 'frame-summary' && s.count === 2 && s.maxMs === 100));
    assert.ok(report.samples.some(s => s.kind === 'timer-delay' && s.durationMs! >= 50));
    assert.ok(report.samples.some(s => s.kind === 'composer-layout' && s.durationMs === 12 && s.active));
    assert.ok(report.samples.some(s => s.kind === 'transcript-render' && s.durationMs === 20 && s.active === false && s.atMs > report.markerMs));
    assert.equal(f.diagnostics.capturing, false);
    assert.ok(report.samples.every(s => Object.keys(s).every(key => ['atMs', 'kind', 'durationMs', 'maxMs', 'count', 'active'].includes(key))));
  } finally { f.close(); }
});

test('old history expires from capture; input timing never includes text and does not prevent editing', async () => {
  const f = fixture();
  try {
    f.diagnostics.setEnabled(true);
    f.diagnostics.probe.record('snapshot', false);
    f.elapse(70_000);
    const input = f.win.document.querySelector('textarea')!;
    input.value = 'secret prompt';
    const event = new f.win.Event('input', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'timeStamp', { value: 69_900 });
    input.dispatchEvent(event);
    const key = new f.win.KeyboardEvent('keydown', { key: 'Never record this key', bubbles: true, cancelable: true });
    Object.defineProperty(key, 'timeStamp', { value: 69_980 }); input.dispatchEvent(key);
    const wheel = new f.win.WheelEvent('wheel', { deltaY: 999, bubbles: true, cancelable: true });
    Object.defineProperty(wheel, 'timeStamp', { value: 69_960 }); input.dispatchEvent(wheel);
    assert.equal(key.defaultPrevented, false); assert.equal(wheel.defaultPrevented, false);
    assert.equal(event.defaultPrevented, false);
    f.frame(40);
    const pending = f.diagnostics.capture(); f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    assert.equal(report.samples.some(s => s.kind === 'snapshot'), false);
    assert.ok(report.samples.some(s => s.kind === 'input-delay' && s.durationMs === 100));
    assert.ok(report.samples.some(s => s.kind === 'input-next-frame' && s.durationMs === 40));
    assert.ok(report.samples.some(s => s.kind === 'key-delay' && s.durationMs === 20));
    assert.ok(report.samples.some(s => s.kind === 'wheel-delay' && s.durationMs === 40));
    assert.doesNotMatch(JSON.stringify(report), /secret|prompt|textarea|Never record|deltaY/);
    assert.equal(report.startMs, report.markerMs - 60_000);
  } finally { f.close(); }
});

test('visibility suspends sampling without false resume gaps; disable/dispose cancels capture and clears history', async () => {
  const f = fixture();
  try {
    f.diagnostics.setEnabled(true); f.frame();
    f.visibility(true); assert.equal(f.frames.size + f.timers.size, 0);
    f.elapse(10_000); f.visibility(false); f.frame(); f.frame();
    const pending = f.diagnostics.capture(); f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    assert.ok(report.samples.some(s => s.kind === 'hidden'));
    assert.equal(report.samples.some(s => s.kind === 'frame-gap'), false);
    const cancelled = f.diagnostics.capture();
    f.diagnostics.setEnabled(false);
    assert.equal(await cancelled, null); assert.equal(f.frames.size + f.timers.size, 0);
    f.diagnostics.setEnabled(true);
    const fresh = f.diagnostics.capture(); f.elapse(AFTER_MS); f.runTimers();
    const next = (await fresh)!;
    assert.equal(next.samples.some(s => s.kind === 'hidden'), false);
    const disposed = f.diagnostics.capture(); f.diagnostics.dispose();
    assert.equal(await disposed, null); assert.equal(f.frames.size + f.timers.size, 0);
    f.diagnostics.setEnabled(true); assert.equal(f.diagnostics.enabled, false);
  } finally { f.close(); }
});

test('exceptional measured work keeps its error and timing; saturation is explicit in reports', async () => {
  const f = fixture();
  try {
    f.diagnostics.setEnabled(true);
    assert.throws(() => f.diagnostics.probe.measure('input-handler', () => { f.elapse(5); throw new Error('fixture'); }), /fixture/);
    const pending = f.diagnostics.capture();
    for (let i = 0; i < MAX_SAMPLES + 20; i++) f.diagnostics.probe.record('snapshot', false);
    f.elapse(AFTER_MS); f.runTimers();
    const report = (await pending)!;
    assert.equal(report.samples.length, MAX_SAMPLES);
    assert.ok(report.droppedSamples > 0);
  } finally { f.close(); }
});
