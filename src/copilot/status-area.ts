import type { StatusAreaCapabilities, StatusAreaSnapshot } from '../status-area';
import { presentCopilotUsage, type CopilotUsage } from './usage';

const capabilities: StatusAreaCapabilities = { metrics: { label: 'Copilot-reported usage' } };
export interface CopilotStatusAreaState {
  readonly model?: string;
  readonly effort?: string;
  readonly supportsModel: boolean;
  readonly supportsThinking: boolean;
  /** Whether the connected session accepts configuration intent (including deferred changes). */
  readonly available: boolean;
  readonly usage?: CopilotUsage;
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
        ...(state.supportsModel ? [{ id: 'model', label: state.model || 'default model', title: 'Select Copilot model', disabled }] : []),
        ...(state.supportsThinking || state.supportsModel && !state.model ? [{ id: 'thinking', label: state.effort || 'default effort',
          title: state.supportsThinking ? 'Select Copilot reasoning effort' : 'Select a model to choose Copilot reasoning effort', disabled }] : []),
      ];
    }
    const { metrics, metricsTitle } = previous && previous.usage === state.usage
      ? { metrics: snapshot?.metrics, metricsTitle: snapshot?.metricsTitle } : presentCopilotUsage(state.usage);
    if (!snapshot || snapshot.controls !== controls || snapshot.metrics !== metrics || snapshot.metricsTitle !== metricsTitle)
      snapshot = { capabilities, controlsLabel: 'Copilot configuration', controls: controls || [], metrics, metricsTitle };
    previous = state;
    return snapshot;
  };
}
