import assert from "node:assert/strict";
import test from "node:test";
import { SessionStatsController, SessionStatsScheduler, SessionStatsTransport } from "../src/pi/session-stats-controller";
import { formatNativeSessionStats, nativeSessionStats } from "../src/pi/session-stats";
import { JsonRecord, NativeSessionStats } from "../src/pi/types";

class FakeScheduler implements SessionStatsScheduler {
  nowMs = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number { return this.nowMs; }
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  clearTimeout(timer: ReturnType<typeof setTimeout>): void { this.timers.delete(timer as unknown as number); }
  advance(ms: number): void {
    this.nowMs += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.nowMs) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
  get size(): number { return this.timers.size; }
}

class DeferredTransport implements SessionStatsTransport {
  calls: Array<{ type: string; resolve: (value: JsonRecord) => void }> = [];
  request(type: string): Promise<JsonRecord> {
    return new Promise((resolve) => this.calls.push({ type, resolve }));
  }
  resolvePair(cost: number): void {
    const stats = this.calls.find((call) => call.type === "get_session_stats");
    const state = this.calls.find((call) => call.type === "get_state");
    assert.ok(stats);
    assert.ok(state);
    stats.resolve({ data: { cost, contextUsage: { tokens: 1_000, contextWindow: 1_100_000, percent: 0.1 } } });
    state.resolve({ data: { autoCompactionEnabled: true } });
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("native Pi stats distinguish zero, missing values, and post-compaction null context", () => {
  const zero = nativeSessionStats({ cost: 0, contextUsage: { tokens: 0, contextWindow: 1_100_000, percent: 0 } }, { autoCompactionEnabled: true });
  assert.equal(formatNativeSessionStats(zero), "$0.000 · 0% / 1.1M · Auto compact");

  const unknownAfterCompaction = nativeSessionStats({ cost: 0, contextUsage: { tokens: null, contextWindow: 1_100_000, percent: null } }, { autoCompactionEnabled: false });
  assert.equal(formatNativeSessionStats(unknownAfterCompaction), "$0.000 · — / 1.1M · Auto compact off");

  const missing = nativeSessionStats({}, {});
  assert.equal(formatNativeSessionStats(missing), "$??? · — / — · Auto compact —");
});

test("stats refreshes coalesce while streaming and timers are disposed", async () => {
  const rpc = new DeferredTransport();
  const scheduler = new FakeScheduler();
  const received: Array<NativeSessionStats | undefined> = [];
  const controller = new SessionStatsController(rpc, { onStats: (stats) => received.push(stats) }, scheduler, 3_000);

  controller.refresh();
  controller.refresh();
  controller.refresh();
  assert.deepEqual(rpc.calls.map((call) => call.type), ["get_session_stats", "get_state"]);

  rpc.resolvePair(0);
  await settle();
  assert.equal(received.length, 1);
  assert.equal(received[0]?.cost, 0);
  assert.equal(scheduler.size, 1, "coalesced refresh waits for the interval");

  scheduler.advance(2_999);
  assert.equal(rpc.calls.length, 2);
  scheduler.advance(1);
  assert.equal(rpc.calls.length, 4);

  controller.dispose();
  assert.equal(scheduler.size, 0);
  scheduler.advance(10_000);
  assert.equal(rpc.calls.length, 4);
});

test("invalidating a model drops a stale in-flight stats result", async () => {
  const rpc = new DeferredTransport();
  const scheduler = new FakeScheduler();
  const received: Array<NativeSessionStats | undefined> = [];
  const controller = new SessionStatsController(rpc, { onStats: (stats) => received.push(stats) }, scheduler, 3_000);

  controller.refresh();
  controller.invalidate();
  rpc.resolvePair(1);
  await settle();

  assert.deepEqual(received, [undefined]);
  assert.equal(scheduler.size, 1, "a current read remains scheduled after the old request settles");
});
