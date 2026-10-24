import type { ConversationInteraction } from '../conversation-view-host';
import type { SlashCommand } from '../pi/slash-completion';
import { keyboardSubmissionMode } from '../pi/composer-dom';
import { newlineHint, sendHint } from '../composer-hints';
import type { AcpSession } from './session';
import type { HarnessActionContribution as SessionAction } from '../harness-contract';

export function acpSessionActions(session: AcpSession | undefined): readonly SessionAction[] {
  const actions: SessionAction[] = [];
  if (session?.configuration.capabilities.some(setting => setting.id === 'model')) actions.push({ id: 'model', label: 'Select model…', detail: 'Choose the model for this session' });
  if (session?.configuration.capabilities.some(setting => setting.id === 'effort')) actions.push({ id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', detail: 'Choose the thinking level for this session' });
  if (session?.options.length) actions.push({ id: 'harness-acp-options', label: 'ACP session options…', detail: 'Configuration selectors advertised by this ACP agent' });
  return actions;
}

export function agentSlashCommands(raw: unknown): SlashCommand[] {
  const commands = new Map<string, SlashCommand>();
  if (Array.isArray(raw)) for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const { name, description } = value as Record<string, unknown>;
    if (typeof name !== 'string' || !name || /[\s\u0000-\u001f]/.test(name) || name.startsWith('/') || commands.has(name)) continue;
    commands.set(name, { name, description: typeof description === 'string' ? description : 'Agent command', source: 'Agent' });
  }
  return [...commands.values()];
}

/** ACP owns busy rejection and advertised commands. No synthetic steering or queues. */
export function acpInteraction(label: string, validate: (text: string) => string | undefined): ConversationInteraction {
  return {
    label,
    commands: agentSlashCommands,
    keyboardMode: event => keyboardSubmissionMode(event, false),
    composer: state => ({ hint: state.busy ? [{ text: 'Agent working' }, { text: 'Stop to cancel' }, newlineHint] : [sendHint, newlineHint], stopLabel: `Stop ${label}` }),
    prepare(text) {
      const error = validate(text);
      return error ? { kind: 'reject', error } : { kind: 'request', message: { type: 'prompt' }, preview: !text.startsWith('/'), navigate: true };
    },
  };
}
