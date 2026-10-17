import type { StatusAreaCapabilities, StatusAreaSnapshot } from '../status-area';
import { presentCopilotUsage, type CopilotUsage } from './usage';

const capabilities: StatusAreaCapabilities = { metrics: { label: 'Copilot-reported usage' } };
const modeLabel = (mode?: string) => mode === 'plan' ? 'Plan' : mode === 'autopilot' ? 'Autopilot' : 'Interactive';
export interface CopilotStatusAreaState {
  readonly model?: string;
  readonly effort?: string;
  readonly mode?: string;
  readonly supportsModel: boolean;
  readonly supportsThinking: boolean;
  readonly supportsMode: boolean;
  readonly supportsContext: boolean;
  /** Whether the connected session accepts configuration intent (including deferred changes). */
  readonly available: boolean;
  readonly usage?: CopilotUsage;
}

export function createCopilotStatusArea(): (state: CopilotStatusAreaState) => StatusAreaSnapshot {
  let previous: CopilotStatusAreaState | undefined;
  let snapshot: StatusAreaSnapshot | undefined;
  return state => {
    let controls = snapshot?.controls;
    if (!previous || previous.model !== state.model || previous.effort !== state.effort || previous.mode !== state.mode
      || previous.supportsModel !== state.supportsModel || previous.supportsThinking !== state.supportsThinking
      || previous.supportsMode !== state.supportsMode || previous.available !== state.available) {
      const disabled = !state.available;
      controls = [
        ...(state.supportsModel ? [{ id: 'model', label: state.model || 'default model', title: 'Select Copilot model', disabled }] : []),
        ...(state.supportsThinking || state.supportsModel && !state.model ? [{ id: 'thinking', label: state.effort || 'default effort',
          title: state.supportsThinking ? 'Select Copilot reasoning effort' : 'Select a model to choose Copilot reasoning effort', disabled }] : []),
        ...(state.supportsMode ? [{ id: 'mode', label: modeLabel(state.mode), title: 'Select Copilot mode', disabled }] : []),
      ];
    }
    const usage = previous && previous.usage === state.usage && previous.supportsContext === state.supportsContext
      ? { metrics: snapshot?.metrics, metricParts: snapshot?.metricParts, metricsTitle: snapshot?.metricsTitle }
      : presentCopilotUsage(state.usage, state.supportsContext);
    if (!snapshot || snapshot.controls !== controls || snapshot.metrics !== usage.metrics || snapshot.metricParts !== usage.metricParts
      || snapshot.metricsTitle !== usage.metricsTitle)
      snapshot = { capabilities, controlsLabel: 'Copilot configuration', controls: controls || [], ...usage };
    previous = state;
    return snapshot;
  };
}
