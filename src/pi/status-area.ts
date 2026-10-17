import type { StatusAreaCapabilities, StatusAreaControl, StatusAreaInformation, StatusAreaSnapshot } from '../status-area';
import { informationalExtensionStatuses, presentActivity } from './activity-state';
import { formatNativeSessionStats } from './session-stats';
import type { PiViewState } from './view-state';

const capabilities: StatusAreaCapabilities = {
  metrics: { label: 'Native Pi session estimates' }, information: true, subagents: true, queue: true,
};
type PiStatusState = Pick<PiViewState, 'modelControls' | 'sessionUnavailable' | 'extensionStatuses' | 'extensionWidgets' | 'sessionStats' | 'busy' | 'status'>;
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** No transcript access; Pi owns configuration gates and extension semantics. */
export function createPiStatusArea(): (state: PiStatusState) => StatusAreaSnapshot {
  let previous: PiStatusState | undefined;
  let snapshot: StatusAreaSnapshot | undefined;
  let controls: readonly StatusAreaControl[] = [];
  let information: readonly StatusAreaInformation[] = [];
  let metrics: string | undefined;
  let subagents: string | undefined;
  return state => {
    if (!previous || previous.modelControls !== state.modelControls || previous.sessionUnavailable !== state.sessionUnavailable) {
      const config = state.modelControls, current = config?.model;
      const model = current ? text(current.id) : 'No model';
      const identity = current ? `${text(current.provider)}/${text(current.id)}` : 'unavailable';
      const thinking = config?.ready ? config.thinkingLevel || 'unavailable' : 'Loading…';
      const disabled = config?.ready !== true || state.sessionUnavailable === true;
      controls = [
        { id: 'model', label: config?.ready ? model : 'Loading model…', title: config?.ready ? `Select model: ${identity}` : 'Loading model', disabled },
        { id: 'thinking', label: thinking, title: config?.ready ? `Select thinking level: ${thinking}` : 'Loading thinking level', disabled },
      ];
    }
    if (!previous || previous.extensionStatuses !== state.extensionStatuses || previous.extensionWidgets !== state.extensionWidgets) {
      const rows = informationalExtensionStatuses(state.extensionStatuses).map(([label, text]) => ({ label, text }));
      for (const [label, widget] of Object.entries(state.extensionWidgets || {})) {
        if (widget && Array.isArray(widget.lines) && widget.lines.every(line => typeof line === 'string')) rows.push(...widget.lines.map(line => ({ label, text: line as string })));
      }
      information = rows;
    }
    if (!previous || previous.busy !== state.busy || previous.status !== state.status || previous.extensionStatuses !== state.extensionStatuses)
      subagents = presentActivity(!!state.busy, state.status, state.extensionStatuses).subagents;
    if (!previous || previous.sessionStats !== state.sessionStats) metrics = state.sessionStats ? formatNativeSessionStats(state.sessionStats) : undefined;
    if (!snapshot || snapshot.controls !== controls || snapshot.information !== information || snapshot.metrics !== metrics || snapshot.subagents !== subagents)
      snapshot = { capabilities, controlsLabel: 'Pi model settings', controls, information, metrics, subagents };
    previous = state;
    return snapshot;
  };
}
