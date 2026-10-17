import type { ConversationControl, ConversationInteraction, ConversationViewState, InformationRow } from '../conversation-view-host';
import { informationalExtensionStatuses, presentActivity } from './activity-state';
import { keyboardHint, keyboardSubmissionMode } from './composer-dom';
import { formatNativeSessionStats } from './session-stats';
import { renderSkillInvocation } from './skill-invocation';
import { slashCommands } from './slash-completion';
import type { PiViewState } from './view-state';
import type { SessionAction } from '../session-backend';

export const piSessionActions: readonly SessionAction[] = [
  { id: 'mcp', label: 'MCP servers…', detail: 'Inspect this Pi session’s MCP connections, exposure and reported errors' },
  { id: 'model', label: 'Select model…', detail: 'Choose the model for this session' },
  { id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', detail: 'Choose reasoning effort for this session' },
];

/** Pi owns slash interception, steering/queue semantics, compaction and skill UI. */
export const piInteraction: ConversationInteraction = {
  label: 'Pi', controlsLabel: 'Pi model settings', metricsLabel: 'Native Pi session estimates',
  commands: slashCommands,
  keyboardMode: keyboardSubmissionMode,
  composer: state => ({ hint: state.inputLocked ? 'Compacting context… · Stop to cancel' : keyboardHint(state.busy === true), stopLabel: state.inputLocked ? 'Cancel compaction' : 'Stop Pi' }),
  prepare(text, state) {
    const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(text);
    if (/^\/(?:resume|delete|new|fork|clone|tree|reload|quit)(?:\s|$)/.test(text)) return { kind: 'reject', error: 'Use the project session controls for session management. This slash operation is not supported; nothing was sent.' };
    if (compact && (state.sessionUnavailable || state.busy || state.inputLocked)) return { kind: 'reject', error: 'Manual compaction is available only while Pi is idle. Your draft was kept.' };
    if (text === '/mcp') return { kind: 'local', message: { type: 'inspectMcp' } };
    if (compact) return { kind: 'request', message: { type: 'compact', customInstructions: compact[1]?.trim() || undefined }, preview: false, navigate: false };
    return { kind: 'request', message: { type: 'prompt' }, preview: !text.startsWith('/'), navigate: !/^\/name(?:\s|$)/.test(text) };
  },
  userText: (document, text, key, expanded, markdown, previous) => renderSkillInvocation(document, text, key, expanded, markdown, previous),
};

const text = (value: unknown) => typeof value === 'string' ? value : '';
/** A projection, not a reducer. Preserve lazy transcript access and stable UI dependencies. */
export function createPiViewProjection(): (state: PiViewState) => ConversationViewState {
  let previous: PiViewState | undefined;
  let controls: readonly ConversationControl[] = [];
  let information: readonly InformationRow[] = [];
  let activity: ReturnType<typeof presentActivity> | undefined;
  let metrics: string | undefined;
  let queue: ConversationViewState['queue'];
  return state => {
    if (!previous || previous.modelControls !== state.modelControls || previous.sessionUnavailable !== state.sessionUnavailable) {
      const config = state.modelControls, current = config?.model;
      const model = current ? text(current.id) : 'No model';
      const identity = current ? `${text(current.provider)}/${text(current.id)}` : 'unavailable';
      const thinking = config?.ready ? config.thinkingLevel || 'unavailable' : 'Loading…';
      const disabled = config?.ready !== true || config.changing === true || state.sessionUnavailable === true;
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
    if (!previous || previous.busy !== state.busy || previous.status !== state.status || previous.extensionStatuses !== state.extensionStatuses) activity = presentActivity(!!state.busy, state.status, state.extensionStatuses);
    if (!previous || previous.sessionStats !== state.sessionStats) metrics = state.sessionStats ? formatNativeSessionStats(state.sessionStats) : undefined;
    if (!previous || previous.queue !== state.queue) queue = state.queue ? { ...state.queue, unavailableLabel: 'Pi queue' } : undefined;
    previous = state;
    return {
      // Do not spread the state: TranscriptUpdates owns a lazy messages getter.
      get messages() { return state.messages; },
      deletionLocked: state.deletionLocked, busy: state.busy, status: activity?.text,
      sessionUnavailable: state.sessionUnavailable, recoveryNotice: state.recoveryNotice,
      inputLocked: state.compacting, controls, subagents: activity?.subagents, information, metrics, queue,
    };
  };
}
