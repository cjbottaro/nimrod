/** One owner for deferred transcript following; layout growth is not user intent. */
export class TranscriptScroll {
  private frame: number | undefined;
  private pending = false;
  private interrupted = false;
  private suspended = false;
  private suspendedFollow = false;
  private suspendedY = 0;
  private lastScrollY: number;
  private lastMaxScroll: number;
  private viewportHeight: number;
  private viewportWidth: number;
  private readonly onScroll = () => {
    if (this.suspended) return;
    // Resizing can anchor/clamp the scroll offset before observer delivery.
    // Preserve the old geometry until resize() has recovered follow intent.
    if (this.viewport.clientHeight !== this.viewportHeight || this.viewport.clientWidth !== this.viewportWidth) return;
    const y = this.viewport.scrollTop;
    const max = this.maxScroll();
    // Completion collapse can clamp the viewport upward to a new document
    // bottom. That is layout, not a reader choosing to leave live-follow.
    const clampedToBottom = max < this.lastMaxScroll && y >= max - 1;
    // At fractional zoom WebKit can settle a programmatic scroll a pixel above
    // the value read immediately after assignment. A new turn may already have
    // grown the transcript while its follow frame is pending, so the deferred
    // event still denotes the OLD bottom. Comparing only with the new bottom
    // mistakes that rounding for upward navigation and cancels follow permanently.
    // Wheel/touch/key intent cancels separately, before this tolerance applies.
    const roundingBottom = this.pending ? Math.min(max, this.lastMaxScroll) : max;
    const roundedAtBottom = Math.abs(y - this.lastScrollY) <= 2
      && y >= roundingBottom - 2 && this.lastScrollY >= this.lastMaxScroll - 2;
    if (y < this.lastScrollY && !clampedToBottom && !roundedAtBottom) this.cancel();
    else if (y > this.lastScrollY && this.isNearBottom()) this.interrupted = false;
    this.lastScrollY = y;
    this.lastMaxScroll = max;
  };
  private readonly onWheel = (event: WheelEvent) => {
    // Trackpads often include a small vertical delta while horizontally
    // scrolling a code block. That is not intent to leave transcript follow.
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    if (event.deltaY < 0) this.cancel();
    else if (event.deltaY > 0 && this.isNearBottom()) this.interrupted = false;
  };
  private touchPosition: { x: number; y: number } | undefined;
  private readonly onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    this.touchPosition = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  };
  private readonly onTouch = (event: TouchEvent) => {
    const touch = event.touches?.[0];
    const previous = this.touchPosition;
    if (!touch || !previous) return;
    const dx = touch.clientX - previous.x;
    const dy = touch.clientY - previous.y;
    this.touchPosition = { x: touch.clientX, y: touch.clientY };
    if (Math.abs(dy) > Math.abs(dx)) this.cancel();
  };
  private readonly onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('textarea, input, select, [contenteditable="true"]')) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) this.cancel();
    else if (["ArrowDown", "PageDown", "End", " "].includes(event.key) && this.isNearBottom()) this.interrupted = false;
  };

  constructor(private readonly window: Window, private readonly viewport: HTMLElement) {
    this.lastScrollY = viewport.scrollTop;
    this.viewportHeight = viewport.clientHeight;
    this.viewportWidth = viewport.clientWidth;
    this.lastMaxScroll = this.maxScroll();
    viewport.addEventListener("scroll", this.onScroll, { passive: true });
    viewport.addEventListener("wheel", this.onWheel, { passive: true });
    viewport.addEventListener("touchstart", this.onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", this.onTouch, { passive: true });
    viewport.addEventListener("keydown", this.onKey);
  }

  /** The pane has already resized at observer delivery. Recover follow intent
   * from the last settled geometry, then reconcile before paint. */
  resize(): void {
    if (this.suspended) return;
    const follow = this.capture();
    this.viewportHeight = this.viewport.clientHeight;
    this.viewportWidth = this.viewport.clientWidth;
    this.request(follow);
    this.flush();
    this.lastScrollY = this.viewport.scrollTop;
    this.lastMaxScroll = this.maxScroll();
  }

  private maxScroll(): number {
    return Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight);
  }

  private isNearBottom(): boolean {
    return this.viewport.scrollTop + this.viewport.clientHeight >= this.viewport.scrollHeight - 80;
  }

  capture(): boolean {
    if (this.suspended) return this.suspendedFollow;
    // Composer changes can resize the pane before render or ResizeObserver
    // runs. Current geometry may already be clamped or far from the bottom;
    // use the last settled geometry, not a mixture of old and new dimensions.
    const resized = this.viewport.clientHeight !== this.viewportHeight || this.viewport.clientWidth !== this.viewportWidth;
    const nearBottom = resized ? this.lastScrollY >= this.lastMaxScroll - 80 : this.isNearBottom();
    return !this.interrupted && (this.pending || nearBottom);
  }

  request(follow: boolean): void {
    if (!follow || this.interrupted) return;
    this.pending = true;
    if (!this.suspended && this.frame === undefined) this.frame = this.window.requestAnimationFrame(() => this.flush());
  }

  /** Both frame delivery and viewport resize use this single bottom target. */
  flush(): void {
    if (this.suspended) return;
    if (this.frame !== undefined) this.window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (!this.pending) return;
    this.pending = false;
    this.viewport.scrollTop = this.viewport.scrollHeight;
    this.lastScrollY = this.viewport.scrollTop;
    this.lastMaxScroll = this.maxScroll();
  }

  /** Explicit navigation overrides reading position and re-enables bottom-follow. */
  scrollToBottom(): void {
    this.interrupted = false;
    if (this.suspended) this.suspendedFollow = true;
    this.request(true);
    this.flush();
    // Reconcile once more after selection/composer layout has settled.
    this.request(true);
  }

  cancel(): void {
    this.interrupted = true;
    this.pending = false;
    if (this.frame !== undefined) this.window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  /** Hide/show a mounted tab without interpreting zero geometry as reader intent. */
  setActive(active: boolean): void {
    if (active === !this.suspended) return;
    if (!active) {
      this.suspendedFollow = this.capture();
      this.suspendedY = this.viewport.scrollTop;
      this.suspended = true;
      if (this.frame !== undefined) this.window.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    } else {
      this.suspended = false;
      this.viewport.scrollTop = this.suspendedY;
      this.viewportHeight = this.viewport.clientHeight;
      this.viewportWidth = this.viewport.clientWidth;
      this.lastScrollY = this.viewport.scrollTop;
      this.lastMaxScroll = this.maxScroll();
      this.request(this.suspendedFollow);
      this.flush();
    }
  }

  dispose(): void {
    this.cancel();
    this.viewport.removeEventListener("scroll", this.onScroll);
    this.viewport.removeEventListener("wheel", this.onWheel);
    this.viewport.removeEventListener("touchstart", this.onTouchStart);
    this.viewport.removeEventListener("touchmove", this.onTouch);
    this.viewport.removeEventListener("keydown", this.onKey);
  }
}
