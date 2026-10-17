import type { ConversationInteraction } from '../conversation-view-host';
import { keyboardSubmissionMode } from '../pi/composer-dom';
import type { SessionAction } from '../session-backend';
import type { CopilotSession } from './session';
import { copilotSlashCommands } from './commands';
export function copilotSessionActions(session?: CopilotSession): readonly SessionAction[] {
  return [
    ...(session?.configuration.capabilities.some(setting => setting.id === 'model') ? [{ id: 'model' as const, label: 'Select model…', detail: 'Choose the model for this session' }] : []),
    ...(session && (session.supports('thinking') || session.configuration.capabilities.some(setting => setting.id === 'effort')) ? [{ id: 'thinking' as const, label: 'Select thinking level…', detail: 'Choose the thinking level for this session', keywords: 'effort reasoning' }] : []),
  ];
}
export function copilotInteraction(validate: (text: string) => string | undefined): ConversationInteraction {
  return {
    label: 'Copilot',
    unsupportedImages: 'Copilot sessions currently accept text only. No image was attached.',
    commands: copilotSlashCommands,
    keyboardMode: event => keyboardSubmissionMode(event, false),
    composer: state => ({ hint: state.busy ? 'Copilot working · Stop to cancel · Shift+Enter for newline' : 'Enter to send · Shift+Enter for newline', stopLabel: 'Stop Copilot' }),
    prepare(text) {
      const error = validate(text);
      const command = text.startsWith('/');
      return error ? { kind: 'reject', error } : { kind: 'request', message: { type: command ? 'command' : 'prompt' }, preview: !command, navigate: !command };
    },
  };
}
