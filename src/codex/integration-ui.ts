import { CodexQuestionInteraction } from './question-interaction';
import { CodexApprovalInteraction } from './approval-interaction';
import type { CodexSessionUi } from './session';
import type { HarnessSessionHost } from '../harness-host';

export function codexIntegrationUi(host: HarnessSessionHost) {
  const { lifetime, effects, ui } = host;
  let questions: CodexQuestionInteraction | undefined, approvals: CodexApprovalInteraction | undefined, sequence = 0;
  const canPresent = () => lifetime.current() && !lifetime.closing() && ui.canPresent();
  const attention = (signal: AbortSignal) => { if (host.ownership.token) effects.attention('input', host.ownership.token, 'Codex', undefined, signal); };
  const question: NonNullable<CodexSessionUi['question']> = (request, signal) => {
    if (signal.aborted || !lifetime.current() || lifetime.closing()) return Promise.resolve(undefined);
    const owner = `${host.id}:codex-question-input`;
    questions ??= new CodexQuestionInteraction({ document: ui.document, canPresent,
      start: dismiss => canPresent() ? ui.palette.startRetainedSelection('Codex question', dismiss) : undefined,
      input: question => ui.dialogs.input(question, undefined, owner, 'Submit answer'), cancelInput: () => ui.dialogs.cancel(owner),
      changed: effects.input,
      banner: (count, review) => {
        if (!count) { effects.resolve('codex-question'); return; }
        effects.notice({ id: 'codex-question', operation: 'Codex questions', message: `Waiting for input · ${count} ${count === 1 ? 'question' : 'questions'}`,
          presentation: 'pending-action', severity: 'info', dismissible: false, actions: [{ label: 'Answer question', enabled: canPresent, run: review }] });
      }, error: message => { if (lifetime.current() && !lifetime.closing()) effects.notice({ id: `codex-question-error:${++sequence}`, operation: 'Answer Codex question', message }); } });
    const result = questions.request(request, signal); attention(signal); return result;
  };
  const approval: CodexSessionUi['approval'] = (request, signal) => {
    if (signal.aborted || !lifetime.current() || lifetime.closing()) return Promise.resolve('cancel');
    approvals ??= new CodexApprovalInteraction({ document: ui.document, canPresent,
      start: dismiss => canPresent() ? ui.palette.startRetainedSelection('Codex approval', dismiss) : undefined,
      changed: effects.input,
      banner: (count, review) => {
        if (!count) { effects.resolve('codex-approval'); return; }
        effects.notice({ id: 'codex-approval', operation: 'Codex approval', message: `Waiting for permission · ${count} ${count === 1 ? 'request' : 'requests'}`,
          presentation: 'pending-action', severity: 'info', dismissible: false, actions: [{ label: 'Review requests', enabled: canPresent, run: review }] });
      } });
    const result = approvals.request(request, signal); attention(signal); return result;
  };
  return { question, approval,
    setActive(active: boolean) { questions?.setActive(active); approvals?.setActive(active); },
    dispose() { questions?.dispose(); approvals?.dispose(); } };
}
