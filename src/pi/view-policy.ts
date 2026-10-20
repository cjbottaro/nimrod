import type { ConversationInteraction, ConversationViewState } from '../conversation-view-host';
import { presentActivity } from './activity-state';
import { createPiStatusArea } from './status-area';
import { keyboardHints, keyboardSubmissionMode } from './composer-dom';
import { parseSkillInvocation } from './skill-invocation';
import { skillUserText } from '../skill-invocation';
import { slashCommands } from './slash-completion';
import type { PiViewState } from './view-state';
import type { SessionAction } from '../session-backend';

export const piSessionActions: readonly SessionAction[] = [
  { id: 'mcp', label: 'MCP servers…', detail: 'Inspect this Pi session’s MCP connections, exposure and reported errors' },
  { id: 'model', label: 'Select model…', detail: 'Choose the model for this session' },
  { id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', detail: 'Choose the thinking level for this session' },
];

const renderPiUserText = skillUserText(parseSkillInvocation);

/** Pi owns slash interception, steering/queue semantics, compaction and skill recognition. */
export const piInteraction: ConversationInteraction = {
  label: 'Pi',
  commands: slashCommands,
  keyboardMode: keyboardSubmissionMode,
  composer: state => ({ hint: state.inputLocked ? 'Compacting context… · Stop to cancel' : keyboardHints(state.busy === true), stopLabel: state.inputLocked ? 'Cancel compaction' : 'Stop Pi' }),
  prepare(text, state) {
    const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(text);
    if (/^\/(?:resume|delete|new|fork|clone|tree|reload|quit)(?:\s|$)/.test(text)) return { kind: 'reject', error: 'Use the project session controls for session management. This slash operation is not supported; nothing was sent.' };
    if (compact && (state.sessionUnavailable || state.busy || state.inputLocked)) return { kind: 'reject', error: 'Manual compaction is available only while Pi is idle. Your draft was kept.' };
    if (text === '/mcp') return { kind: 'local', message: { type: 'inspectMcp' } };
    if (compact) return { kind: 'request', message: { type: 'compact', customInstructions: compact[1]?.trim() || undefined }, preview: false, navigate: false };
    return { kind: 'request', message: { type: 'prompt' }, preview: !text.startsWith('/'), navigate: !/^\/name(?:\s|$)/.test(text) };
  },
  userText(document, text, key, expanded, markdown, previous) {
    // Pi appends model-facing coordinate hints during image normalization.
    // Hide only that exact standalone format; never alter prompt/history data.
    const visible = text.replace(/(^|\r?\n)\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+\.\d{2} to map to original image\.\](?=\r?\n|$)/g, '');
    const content = visible === text ? text : visible.trimEnd();
    const node = renderPiUserText(document, content, key, expanded, markdown, previous);
    node.hidden = !content.trim();
    return node;
  },
};

/** A projection, not a reducer. Preserve lazy transcript access and stable UI dependencies. */
export function createPiViewProjection(): (state: PiViewState) => ConversationViewState {
  let previous: PiViewState | undefined;
  const projectStatus = createPiStatusArea();
  let activity: ReturnType<typeof presentActivity> | undefined;
  let queue: ConversationViewState['queue'];
  return state => {
    if (!previous || previous.busy !== state.busy || previous.status !== state.status || previous.extensionStatuses !== state.extensionStatuses) activity = presentActivity(!!state.busy, state.status, state.extensionStatuses);
    if (!previous || previous.queue !== state.queue) queue = state.queue ? { ...state.queue, unavailableLabel: 'Pi queue' } : undefined;
    previous = state;
    return {
      // Do not spread the state: TranscriptUpdates owns a lazy messages getter.
      get messages() { return state.messages; },
      deletionLocked: state.deletionLocked, busy: state.busy, status: activity?.text,
      sessionUnavailable: state.sessionUnavailable, recoveryNotice: state.recoveryNotice,
      inputLocked: state.compacting, statusArea: projectStatus(state), queue, configurationOperations: state.configurationOperations,
    };
  };
}
