import type { ConversationInteraction } from '../conversation-view-host';
import { keyboardSubmissionMode } from '../pi/composer-dom';
import type { SessionAction } from '../session-backend';
import type { CopilotSession } from './session';
export function copilotSessionActions(session?: CopilotSession): readonly SessionAction[] {
  return [
    ...(session?.supports('model') ? [{ id: 'model' as const, label: 'Select model…', detail: 'Models reported by Copilot SDK' }] : []),
    ...(session?.supports('thinking') ? [{ id: 'thinking' as const, label: 'Select thinking level…', detail: 'Reasoning efforts supported by the current Copilot model', keywords: 'effort reasoning' }] : []),
  ];
}
export function copilotInteraction(validate: (text: string) => string | undefined): ConversationInteraction {
  return {
    label: 'Copilot', controlsLabel: 'Copilot SDK configuration', metricsLabel: 'Copilot-reported usage',
    unsupportedImages: 'Copilot SDK sessions currently accept text only. No image was attached.',
    commands: () => [],
    keyboardMode: event => keyboardSubmissionMode(event, false),
    composer: state => ({ hint: state.busy ? 'Copilot working · Stop to cancel · Shift+Enter for newline' : 'Enter to send · Shift+Enter for newline', stopLabel: 'Stop Copilot' }),
    prepare(text) {
      const error = validate(text);
      return error ? { kind: 'reject', error } : { kind: 'request', message: { type: 'prompt' }, preview: true, navigate: true };
    },
  };
}
