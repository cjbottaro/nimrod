import { QuestionInteraction, type QuestionUi } from '../question-interaction';
export type { QuestionAnswer as CopilotAnswer, QuestionUi as CopilotQuestionUi } from '../question-interaction';
/** Copilot payload mapping only; retained question presentation is shared. */
export class CopilotQuestionInteraction {
  private readonly interaction: QuestionInteraction;
  constructor(ui: QuestionUi) { this.interaction = new QuestionInteraction(ui); }
  get pendingCount(): number { return this.interaction.pendingCount; }
  request(request: Readonly<Record<string, unknown>>, signal: AbortSignal) {
    return this.interaction.request({
      question: typeof request.question === 'string' ? request.question : 'Copilot requests input',
      choices: Array.isArray(request.choices) ? request.choices.filter((value): value is string => typeof value === 'string').map(label => ({ label })) : [],
      freeform: request.allowFreeform !== false,
    }, signal);
  }
  setActive(active: boolean): void { this.interaction.setActive(active); }
  review(): void { this.interaction.review(); }
  dispose(): void { this.interaction.dispose(); }
}
