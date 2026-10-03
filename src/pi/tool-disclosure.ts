import { setToolDetailsAutoOpen, TOOL_AUTO_DISCLOSURE_MS } from "./tool-card";

interface ToolDisclosureState {
  details: HTMLDetailsElement;
  busy: boolean;
  executing: boolean;
  hasStreamingOutput: boolean;
  autoOpenedAt?: number;
  openTimer?: ReturnType<typeof setTimeout>;
  closeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Applies tool-card auto disclosure without confusing it with an explicit user
 * choice. A card qualifies only after it has non-empty execution output for a
 * short period; a qualifying card remains visible for the same minimum dwell.
 */
export class ToolDisclosureController {
  private readonly states = new Map<string, ToolDisclosureState>();

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

    if (state.autoOpenedAt && busy) {
      if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = undefined; }
      return;
    }

    if (executing && hasStreamingOutput) {
      if (state.closeTimer) { clearTimeout(state.closeTimer); state.closeTimer = undefined; }
      if (!state.autoOpenedAt && !details.open && !state.openTimer) {
        state.openTimer = setTimeout(() => {
          state!.openTimer = undefined;
          if (!this.isEligible(key, state!)) return;
          // Notify before `open` changes document height; callers can capture whether
          // the reader was at the old transcript bottom, then reveal next frame.
          this.onAutoOpen?.(details);
          setToolDetailsAutoOpen(details, true);
          state!.autoOpenedAt = Date.now();
        }, this.delayMs);
      }
      return;
    }

    if (state.openTimer) { clearTimeout(state.openTimer); state.openTimer = undefined; }
    if (!state.autoOpenedAt || !details.open) return;
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

  dispose(): void {
    for (const state of this.states.values()) this.clear(state);
    this.states.clear();
  }

  private isEligible(key: string, state: ToolDisclosureState): boolean {
    return !this.expanded.has(key) && state.executing && state.hasStreamingOutput && state.details.isConnected;
  }

  private closeIfEligible(key: string, state: ToolDisclosureState): void {
    if (this.expanded.has(key) || state.busy || !state.details.isConnected) return;
    setToolDetailsAutoOpen(state.details, false);
    state.autoOpenedAt = undefined;
  }

  private clear(state: ToolDisclosureState): void {
    if (state.openTimer) clearTimeout(state.openTimer);
    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.openTimer = undefined;
    state.closeTimer = undefined;
  }
}

