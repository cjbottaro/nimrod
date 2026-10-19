import type { ConversationInteraction } from '../conversation-view-host';
import { keyboardSubmissionMode } from '../pi/composer-dom';
import { newlineHint, sendHint } from '../composer-hints';
import type { SessionAction } from '../session-backend';
import type { CopilotSession } from './session';
import { copilotSlashCommands, findCopilotCommand } from './commands';
export function copilotSessionActions(session?: CopilotSession): readonly SessionAction[] {
  const permissions = session && findCopilotCommand(session.commands, 'permissions');
  return [
    ...(session?.configuration.capabilities.some(setting => setting.id === 'model') ? [{ id: 'model' as const, label: 'Select model…', detail: 'Choose the model for this session' }] : []),
    ...(session && (session.supports('thinking') || session.configuration.capabilities.some(setting => setting.id === 'effort')) ? [{ id: 'thinking' as const, label: 'Select thinking level…', detail: 'Choose the thinking level for this session', keywords: 'effort reasoning' }] : []),
    ...(session?.configuration.capabilities.some(setting => setting.id === 'mode') ? [{ id: 'mode' as const, label: 'Select mode…', detail: 'Choose Interactive, Plan or Autopilot for this session', keywords: 'interactive plan autopilot' }] : []),
    ...(session?.configuration.capabilities.some(setting => setting.id === 'context-tier') ? [{ id: 'context-window' as const, label: 'Select context window…', detail: 'Choose the context window tier for this session', keywords: 'limit tier long context' }] : []),
    ...(permissions?.kind === 'builtin' ? [{ id: 'permissions' as const, label: 'Set permissions…', detail: 'Run this harness’s permission-setting command',
      run: () => session!.invokeCommand(`/${permissions.name}`) }] : []),
  ];
}
export function copilotInteraction(validate: (text: string) => string | undefined): ConversationInteraction {
  return {
    label: 'Copilot',
    commands: copilotSlashCommands,
    keyboardMode: event => keyboardSubmissionMode(event, false),
    composer: state => ({ hint: [state.busy ? { text: 'Stop to cancel' } : sendHint, newlineHint], stopLabel: 'Stop Copilot' }),
    prepare(text) {
      const error = validate(text);
      const command = text.startsWith('/');
      return error ? { kind: 'reject', error } : { kind: 'request', message: { type: command ? 'command' : 'prompt' }, preview: !command, navigate: !command };
    },
  };
}
