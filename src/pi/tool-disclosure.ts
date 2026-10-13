import { setToolDetailsAutoOpen, TOOL_AUTO_DISCLOSURE_MS } from "./card-shell";

interface ToolDisclosureState {
  details: HTMLDetailsElement;
  busy: boolean;
  executing: boolean;
  hasStreamingOutput: boolean;
  autoOpenedAt?: number;
  openTimer?: ReturnType<typeof setTimeout>;
  openDueAt?: number;
  openRemaining?: number;
  closeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Applies tool-card auto disclosure without confusing it with an explicit user
 * choice. A card qualifies only after it has non-empty execution output for a
 * short period; a qualifying card remains visible for the same minimum dwell.
 */
export class ToolDisclosureController {
  private readonly states = new Map<string, ToolDisclosureState>();
  private suspendedAt: number | undefined;

  /** Hidden presentation must not toggle stale cards. Visible delay/dwell pauses;
   * the catch-up paint supplies latest lifecycle data before resuming timers. */
  setActive(active: boolean): void {
    if (active === (this.suspendedAt === undefined)) return;
    if (!active) {
      this.suspendedAt = Date.now();
      for (const state of this.states.values()) {
        const remaining = state.openDueAt === undefined ? undefined : Math.max(0, state.openDueAt - this.suspendedAt);
        this.clear(state);
        state.openRemaining = remaining;
      }
    } else {
      const hiddenDuration = Date.now() - this.suspendedAt!;
      this.suspendedAt = undefined;
      for (const state of this.states.values()) {
        if (state.autoOpenedAt !== undefined) state.autoOpenedAt += hiddenDuration;
        this.update(state.details, state.busy, state.executing, state.hasStreamingOutput);
      }
    }
  }

  constructor(private readonly expanded: Map<string, boolean>, private readonly delayMs = TOOL_AUTO_DISCLOSURE_MS, private readonly onAutoOpen?: (details: HTMLDetailsElement) => void) {}

  update(details: HTMLDetailsElement, busy: boolean, executing: boolean, hasStreamingOutput: boolean): void {
    const key = details.dataset.detailKey;
    if (!key) return;
    let state = this.states.get(key);
    if (state?.details !== details) {
      if (state) this.clear(state);
      state = { details, busy, executing, hasStreamingOutput };
      this.states.set(key, state);
    } else {
      state.busy = busy;
      state.executing = executing;
      state.hasStreamingOutput = hasStreamingOutput;
    }

    if (this.expanded.has(key)) {
      this.clear(state);
      return;
    }

    if (this.suspendedAt !== undefined) {
      if (!executing || !hasStreamingOutput) state.openRemaining = undefined;
      return;
    }

    if (state.autoOpenedAt !== undefined && busy) {
      if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = undefined; }
      return;
    }

    if (executing && hasStreamingOutput) {
      if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = undefined; }
      if (state.autoOpenedAt === undefined && !details.open && !state.openTimer) {
        const delay = state.openRemaining ?? this.delayMs;
        state.openRemaining = undefined;
        state.openDueAt = Date.now() + delay;
        state.openTimer = setTimeout(() => {
          state!.openTimer = undefined;
          state!.openDueAt = undefined;
          if (!this.isEligible(key, state!)) return;
          // Notify before `open` changes document height; callers can capture whether
          // the reader was at the old transcript bottom, then reveal next frame.
          this.onAutoOpen?.(details);
          setToolDetailsAutoOpen(details, true);
          state!.autoOpenedAt = Date.now();
        }, delay);
      }
      return;
    }

    if (state.openTimer) { clearTimeout(state.openTimer); state.openTimer = undefined; }
    state.openDueAt = undefined;
    state.openRemaining = undefined;
    if (state.autoOpenedAt === undefined || !details.open) return;
    const remaining = Math.max(0, this.delayMs - (Date.now() - state.autoOpenedAt));
    if (remaining === 0) this.closeIfEligible(key, state);
    else if (!state.closeTimer) {
      state.closeTimer = setTimeout(() => {
        state!.closeTimer = undefined;
        this.closeIfEligible(key, state!);
      }, remaining);
    }
  }

  manualToggle(key: string): void {
    const state = this.states.get(key);
    if (!state) return;
    this.clear(state);
  }

  remove(key: string): void {
    const state = this.states.get(key);
    if (state) this.clear(state);
    this.states.delete(key);
  }

  dispose(): void {
    for (const state of this.states.values()) this.clear(state);
    this.states.clear();
  }

  private isEligible(key: string, state: ToolDisclosureState): boolean {
    return this.suspendedAt === undefined && !this.expanded.has(key) && state.executing && state.hasStreamingOutput && state.details.isConnected;
  }

  private closeIfEligible(key: string, state: ToolDisclosureState): void {
    if (this.suspendedAt !== undefined || this.expanded.has(key) || state.busy || !state.details.isConnected) return;
    setToolDetailsAutoOpen(state.details, false);
    state.autoOpenedAt = undefined;
  }

  private clear(state: ToolDisclosureState): void {
    if (state.openTimer) clearTimeout(state.openTimer);
    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.openTimer = undefined;
    state.openDueAt = undefined;
    state.openRemaining = undefined;
    state.closeTimer = undefined;
  }
}

