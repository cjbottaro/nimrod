import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TranscriptScroll } from "../src/pi/transcript-scroll";

function fixture() {
  const dom = new JSDOM("", { pretendToBeVisual: true });
  const win = dom.window;
  let height = 1000;
  let y = 400;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const scrolls: number[] = [];
  const viewport = win.document.createElement("div");
  win.document.body.append(viewport);
  let clientHeight = 600;
  let clientWidth = 900;
  Object.defineProperties(viewport, {
    clientHeight: { get: () => clientHeight },
    clientWidth: { get: () => clientWidth },
    scrollHeight: { get: () => height },
    scrollTop: { get: () => y, set: (top: number) => { y = Math.max(0, Math.min(top, height - clientHeight)); scrolls.push(top); } },
  });
  win.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  win.scrollTo = () => assert.fail("must not scroll the outer document");
  const scroll = new TranscriptScroll(win as unknown as Window, viewport);
  return {
    dom, win, viewport, scroll, scrolls, frames,
    setClientHeight(value: number) { clientHeight = value; },
    resize(value: number) { clientHeight = value; scroll.resize(); },
    narrow() {
      clientWidth = 500;
      height = 1800;
      viewport.dispatchEvent(new win.Event("scroll"));
      scroll.resize();
    },
    height(value: number) { height = value; },
    touch(type: "touchstart" | "touchmove", x: number, y: number, target: HTMLElement = viewport) {
      const event = new win.Event(type, { bubbles: true });
      Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
      target.dispatchEvent(event);
    },
    move(value: number) { y = value; viewport.dispatchEvent(new win.Event("scroll")); },
    frame() { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(0)); },
    dispose() { scroll.dispose(); dom.window.close(); },
  };
}

test("follow intent survives layout growth and multiple requests coalesce", () => {
  const f = fixture();
  f.scroll.request(f.scroll.capture());
  f.height(1400);
  assert.equal(f.scroll.capture(), true, "pending follow survives growth past near-bottom threshold");
  f.scroll.request(f.scroll.capture());
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(f.scrolls, [1400]);
  f.dispose();
});

test("pane shrink uses pre-resize height to preserve bottom intent beyond the threshold", () => {
  const f = fixture();
  f.resize(300);
  assert.deepEqual(f.scrolls, [1000]);
  assert.equal(f.viewport.scrollTop, 700);
  f.dispose();
});

test("width reflow preserves pre-resize follow even if anchoring sends a scroll event first", () => {
  const f = fixture();
  f.narrow();
  assert.deepEqual(f.scrolls, [1800]);
  assert.equal(f.viewport.scrollTop, 1200);
  f.dispose();
});

test("capture preserves follow before the composer resize observer arrives", () => {
  const f = fixture();
  f.setClientHeight(480);
  assert.equal(f.scroll.capture(), true, "a tall draft must not look like scrolling into history");
  f.scroll.request(f.scroll.capture());
  f.height(2400); // Large submitted user turn, rendered before resize delivery.
  f.scroll.resize();
  assert.equal(f.viewport.scrollTop, 1920);
  f.dispose();
});

test("composer collapse clamping before observer delivery retains bottom intent", () => {
  const f = fixture();
  f.setClientHeight(720);
  f.move(280); // Native clamp to the new bottom before ResizeObserver.
  f.height(2200);
  f.scroll.resize();
  assert.equal(f.viewport.scrollTop, 1480);
  f.dispose();
});

test("pane resize does not move an older-history reader", () => {
  const f = fixture();
  f.move(100);
  f.resize(300);
  assert.deepEqual(f.scrolls, []);
  f.dispose();
});

test("resize delivery flushes pending follow before paint and cancels queued frame", () => {
  const f = fixture();
  f.scroll.request(f.scroll.capture());
  f.height(1300);
  f.scroll.flush();
  f.frame();
  assert.deepEqual(f.scrolls, [1300]);
  f.dispose();
});

test("history reading does not follow; downward return to bottom resumes following", () => {
  const f = fixture();
  f.move(100);
  f.scroll.request(f.scroll.capture());
  f.height(1200);
  f.frame();
  assert.deepEqual(f.scrolls, []);
  f.move(600);
  f.scroll.request(f.scroll.capture());
  f.height(1400);
  f.frame();
  assert.deepEqual(f.scrolls, [1400]);
  f.dispose();
});

test("upward wheel cancels pending follow before native scrolling, including later resize requests", () => {
  const f = fixture();
  f.scroll.request(f.scroll.capture());
  f.viewport.dispatchEvent(new f.win.WheelEvent("wheel", { deltaY: -10 }));
  f.scroll.request(f.scroll.capture());
  f.height(1200);
  f.scroll.flush();
  f.frame();
  assert.deepEqual(f.scrolls, []);
  f.dispose();
});

test("horizontal gestures in assistant content do not disable transcript follow", () => {
  for (const gesture of [
    (f: ReturnType<typeof fixture>, code: HTMLElement) => code.dispatchEvent(new f.win.WheelEvent("wheel", { deltaX: 120, deltaY: -1, bubbles: true })),
    (f: ReturnType<typeof fixture>, code: HTMLElement) => { f.touch("touchstart", 0, 0, code); f.touch("touchmove", 120, 1, code); },
  ]) {
    const f = fixture();
    const code = f.win.document.createElement("pre");
    f.viewport.append(code);
    gesture(f, code);
    assert.equal(f.scroll.capture(), true, "horizontal input must not latch auto-follow off");
    f.scroll.request(f.scroll.capture());
    f.height(1040); // A single-line submitted turn.
    f.frame();
    assert.equal(f.viewport.scrollTop, 440);
    f.dispose();
  }
});

test("scrollbar movement, navigation keys, and touch cancel pending follow", () => {
  for (const interrupt of [
    (f: ReturnType<typeof fixture>) => f.move(300),
    (f: ReturnType<typeof fixture>) => f.viewport.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "PageUp" })),
    (f: ReturnType<typeof fixture>) => { f.touch("touchstart", 0, 0); f.touch("touchmove", 0, 10); },
  ]) {
    const f = fixture();
    f.scroll.request(f.scroll.capture());
    interrupt(f);
    f.frame();
    assert.deepEqual(f.scrolls, []);
    f.dispose();
  }
});

test("completion collapse clamping to a shorter document bottom does not cancel follow", () => {
  const f = fixture();
  f.height(800);
  f.move(200);
  assert.equal(f.scroll.capture(), true);
  f.scroll.request(f.scroll.capture());
  f.height(1200);
  f.frame();
  assert.deepEqual(f.scrolls, [1200]);
  f.dispose();
});

test("fractional zoom settling at the bottom does not cancel a pending follow", () => {
  for (const adjustment of [0.4, 1, 2]) {
    const f = fixture();
    f.scroll.request(f.scroll.capture()); f.frame();
    f.scroll.request(f.scroll.capture());
    f.move(400 - adjustment); // WebKit's deferred scroll event after native pixel rounding.
    assert.equal(f.scroll.capture(), true);
    assert.equal(f.frames.size, 1, 'rounding must not discard the scheduled follow');
    f.height(1400); f.frame();
    assert.equal(f.viewport.scrollTop, 800);
    f.dispose();
  }
});

test("delayed bottom rounding after a new turn grows the transcript preserves pending follow", () => {
  for (const growth of [40, 1200]) {
    const f = fixture();
    f.scroll.request(f.scroll.capture()); f.frame();
    const follow = f.scroll.capture();
    f.height(1000 + growth); // Render the user turn before the previous scroll event arrives.
    f.scroll.request(follow);
    f.move(399); // Deferred fractional-pixel settling at the OLD bottom.
    assert.equal(f.scroll.capture(), true);
    assert.equal(f.frames.size, 1, "late rounding must not cancel the new turn's follow");
    f.frame();
    assert.equal(f.viewport.scrollTop, 400 + growth);
    f.dispose();
  }
});

test("explicit upward input still wins when followed by bottom rounding", () => {
  for (const interrupt of [
    (f: ReturnType<typeof fixture>) => f.viewport.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -0.5 })),
    (f: ReturnType<typeof fixture>) => f.viewport.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowUp' })),
    (f: ReturnType<typeof fixture>) => { f.touch("touchstart", 0, 0); f.touch("touchmove", 0, 10); },
  ]) {
    const f = fixture(); f.scroll.request(f.scroll.capture());
    interrupt(f); f.move(399); f.height(1400); f.frame();
    assert.equal(f.scroll.capture(), false);
    assert.deepEqual(f.scrolls, []);
    f.dispose();
  }
});

test("meaningful upward scrollbar movement still pauses follow even near the bottom", () => {
  const f = fixture(); f.scroll.request(f.scroll.capture());
  f.move(397); f.height(1400); f.frame();
  assert.equal(f.scroll.capture(), false);
  assert.deepEqual(f.scrolls, []);
  f.dispose();
});

test("composer cursor navigation does not cancel follow and disposal clears pending work", () => {
  const f = fixture();
  const textarea = f.win.document.createElement("textarea");
  f.win.document.body.append(textarea);
  f.scroll.request(f.scroll.capture());
  textarea.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  f.frame();
  assert.deepEqual(f.scrolls, [1000]);
  f.scroll.request(true);
  f.scroll.dispose();
  f.frame();
  assert.deepEqual(f.scrolls, [1000]);
  f.dispose();
});
