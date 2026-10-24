import { invoke } from '@tauri-apps/api/core';
import { CopilotPermissionInteraction } from './permission-interaction';
import { CopilotQuestionInteraction } from './question-interaction';
import { CopilotPlanInteraction } from './plan-interaction';
import type { CopilotDecision } from './session';
import type { HarnessSessionHost } from '../harness-host';

/** Retained concrete SDK decisions; no shell-side interpretation of SDK requests. */
export function copilotIntegrationUi(host: HarnessSessionHost) {
  const { ui, lifetime, effects } = host;
  let permissions: CopilotPermissionInteraction | undefined, questions: CopilotQuestionInteraction | undefined, plans: CopilotPlanInteraction | undefined;
  let sequence = 0;
  const valid = () => lifetime.current() && !lifetime.closing();
  const canPresent = () => valid() && ui.canPresent();
  const banner = (kind: 'permission' | 'question' | 'plan', count: number, review: () => void) => {
    const id = `${kind}-required`;
    if (!count) { effects.resolve(id); return; }
    const message = kind === 'permission' ? `Waiting for permission · ${count} ${count === 1 ? 'request' : 'requests'}`
      : kind === 'question' ? `Waiting for input · ${count} ${count === 1 ? 'question' : 'questions'}`
      : count === 1 ? 'Waiting for plan review' : `Waiting for plan review · ${count} plans`;
    effects.notice({ id, operation: kind === 'plan' ? 'Copilot plan review' : kind === 'question' ? 'Copilot questions' : 'Copilot permissions',
      message, presentation: 'pending-action', severity: 'info', dismissible: false,
      actions: [{ label: kind === 'permission' ? 'Review requests' : kind === 'question' ? 'Answer question' : 'Review plan', enabled: canPresent, run: review }] });
  };
  const error = (operation: string, message: string) => { if (valid()) effects.notice({ id: `decision-error:${++sequence}`, operation, message }); };
  const attention = (signal: AbortSignal) => { if (host.ownership.token) effects.attention('input', host.ownership.token, 'Copilot', undefined, signal); };
  async function decision(kind: 'permission' | 'input' | 'plan', request: Record<string, unknown>, signal: AbortSignal): Promise<CopilotDecision | undefined> {
    if (signal.aborted || !valid()) return kind === 'permission' ? { kind: 'user-not-available' } : undefined;
    if (kind === 'permission') {
      const owner = `${host.id}:permission-feedback`;
      permissions ??= new CopilotPermissionInteraction({ document: ui.document, project: host.project, canPresent,
        start: dismiss => canPresent() ? ui.palette.startRetainedSelection('Copilot permission', dismiss) : undefined,
        feedback: () => ui.dialogs.input('Reason or suggested alternative', undefined, owner, 'Send denial'), cancelFeedback: () => ui.dialogs.cancel(owner),
        changed: effects.input, banner: (count, review) => banner('permission', count, review), error: message => error('Permission feedback', message) });
      const choice = permissions.request(request, signal); attention(signal);
      return await choice ?? { kind: 'user-not-available' };
    }
    if (kind === 'input') {
      const owner = `${host.id}:question-input`;
      questions ??= new CopilotQuestionInteraction({ document: ui.document, canPresent,
        start: dismiss => canPresent() ? ui.palette.startRetainedSelection('Copilot question', dismiss) : undefined,
        input: question => ui.dialogs.input(question, undefined, owner, 'Submit answer'), cancelInput: () => ui.dialogs.cancel(owner),
        changed: effects.input, banner: (count, review) => banner('question', count, review), error: message => error('Answer question', message) });
      const choice = questions.request(request, signal); attention(signal); return choice;
    }
    const owner = `${host.id}:plan-feedback`;
    plans ??= new CopilotPlanInteraction({ document: ui.document, canPresent,
      start: dismiss => canPresent() ? ui.palette.startRetainedSelection('Review Copilot plan', dismiss) : undefined,
      feedback: (revision, current) => ui.dialogs.input(revision ? 'Requested plan changes' : 'Plan feedback (optional)', current, owner, revision ? 'Request changes' : 'Save feedback'),
      cancelFeedback: () => ui.dialogs.cancel(owner), openLink: href => invoke('open_card_link', { href }),
      changed: effects.input, banner: (count, review) => banner('plan', count, review), error: message => error('Plan feedback', message) });
    const choice = plans.request(request, signal); attention(signal); return choice;
  }
  const commandCurrent = (signal: AbortSignal) => valid() && lifetime.selected() && !lifetime.settingsOpen() && !lifetime.deleting() && !signal.aborted;
  return {
    decision,
    async commandChoice(title: string, choices: readonly import('./commands').CommandChoice[], signal: AbortSignal) {
      if (!commandCurrent(signal) || ui.document.querySelector('dialog[open]')) return;
      const request = ui.palette.startSelection(title, () => {}, undefined, true); if (!request) return;
      const cancel = () => request.cancel(); signal.addEventListener('abort', cancel, { once: true });
      try { const selected = await request.chooseItems(choices); return commandCurrent(signal) ? selected : undefined; }
      finally { signal.removeEventListener('abort', cancel); request.finish(); }
    },
    async commandInput(title: string, signal: AbortSignal) {
      const owner = `${host.id}:copilot-command-input`;
      if (!commandCurrent(signal) || ui.document.querySelector('dialog[open]')) return;
      const cancel = () => ui.dialogs.cancel(owner); signal.addEventListener('abort', cancel, { once: true });
      try { const value = await ui.dialogs.input(title, undefined, owner, 'Run command'); return commandCurrent(signal) ? value : undefined; }
      finally { signal.removeEventListener('abort', cancel); }
    },
    setActive(active: boolean) { permissions?.setActive(active); questions?.setActive(active); plans?.setActive(active); },
    dispose() { permissions?.dispose(); questions?.dispose(); plans?.dispose(); },
  };
}
