import type { StatusAreaCapabilities, StatusAreaSnapshot } from '../status-area';

const capabilities: StatusAreaCapabilities = { metrics: { label: 'Copilot-reported usage' } };
export interface CopilotStatusAreaState {
  readonly model?: string;
  readonly effort?: string;
  readonly supportsModel: boolean;
  readonly supportsThinking: boolean;
  /** Whether the connected session accepts configuration intent (including deferred changes). */
  readonly available: boolean;
  readonly usage?: { readonly currentTokens: number; readonly tokenLimit: number };
}

export function createCopilotStatusArea(): (state: CopilotStatusAreaState) => StatusAreaSnapshot {
  let previous: CopilotStatusAreaState | undefined;
  let snapshot: StatusAreaSnapshot | undefined;
  return state => {
    let controls = snapshot?.controls;
    if (!previous || previous.model !== state.model || previous.effort !== state.effort || previous.supportsModel !== state.supportsModel
      || previous.supportsThinking !== state.supportsThinking || previous.available !== state.available) {
      const disabled = !state.available;
      controls = [
        ...(state.supportsModel ? [{ id: 'model', label: state.model || 'Copilot default', title: 'Select Copilot model', disabled }] : []),
        ...(state.supportsThinking ? [{ id: 'thinking', label: state.effort || 'Model default', title: 'Select Copilot reasoning effort', disabled }] : []),
      ];
    }
    const metrics = previous && previous.usage === state.usage ? snapshot?.metrics : state.usage
      ? `${state.usage.currentTokens.toLocaleString()} / ${state.usage.tokenLimit.toLocaleString()} context tokens` : undefined;
    if (!snapshot || snapshot.controls !== controls || snapshot.metrics !== metrics)
      snapshot = { capabilities, controlsLabel: 'Copilot configuration', controls: controls || [], metrics };
    previous = state;
    return snapshot;
  };
}
