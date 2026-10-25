import { renderCodexAnswerCards } from './answer-card';
import type { ConversationInteraction } from '../conversation-view-host';
import { keyboardSubmissionMode } from '../pi/composer-dom';
import { newlineHint, sendHint } from '../composer-hints';
import type { HarnessActionContribution as SessionAction } from '../harness-contract';
import type { CodexSession } from './session';
export function codexSessionActions(session?: CodexSession): readonly SessionAction[] {
  return [
    ...(session?.configuration.capabilities.some(setting => setting.id === 'model') ? [{ id: 'model' as const, label: 'Select model…', detail: 'Choose the Codex model for this session' }] : []),
    ...(session?.configuration.capabilities.some(setting => setting.id === 'effort') ? [{ id: 'thinking' as const, label: 'Select thinking level…', detail: 'Choose Codex reasoning effort' }] : []),
  ];
}
export function codexInteraction(validate: (text: string) => string | undefined): ConversationInteraction {
  return {
    label: 'Codex', commands: () => [],
    userText: (document, text, key, expanded, _markdown, previous) => renderCodexAnswerCards(document, text, key, expanded, previous),
    keyboardMode: (event, busy) => {
      const mode = keyboardSubmissionMode(event, busy);
      return mode === 'followUp' ? undefined : mode;
    },
    composer: state => ({ hint: [state.busy ? { text: 'Enter to steer · Stop to cancel' } : sendHint, newlineHint], stopLabel: 'Stop Codex' }),
    prepare(text) {
      const error = validate(text);
      return error ? { kind: 'reject', error } : { kind: 'request', message: { type: 'prompt' }, preview: true, navigate: true };
    },
  };
}
