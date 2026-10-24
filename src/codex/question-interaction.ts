import { QuestionInteraction, type QuestionUi } from '../question-interaction';
import { CODEX_ANSWER_LIMIT, type CodexQuestionRequest, type CodexQuestionAnswers } from './questions';
/** Codex batches are one RPC response; question presentation/retention is shared with Copilot. */
export class CodexQuestionInteraction {
  private readonly interaction: QuestionInteraction;
  constructor(ui: QuestionUi) { this.interaction = new QuestionInteraction(ui); }
  get pendingCount(): number { return this.interaction.pendingCount; }
  request(request: CodexQuestionRequest, signal: AbortSignal): Promise<CodexQuestionAnswers | undefined> {
    // Enqueue the batch synchronously, preserving FIFO across concurrent native requests.
    const answers = request.questions.map(question => this.interaction.request({
      header: question.header, question: question.question,
      choices: question.options?.map(option => ({ label: option.label, detail: option.description })) ?? [],
      freeform: question.options === null || question.isOther, maxAnswerLength: CODEX_ANSWER_LIMIT,
    }, signal));
    return Promise.all(answers).then(values => values.some(value => value === undefined) ? undefined
      : Object.fromEntries(request.questions.map((question, index) => [question.id, { answers: [values[index]!.answer] }])));
  }
  setActive(active: boolean): void { this.interaction.setActive(active); }
  review(): void { this.interaction.review(); }
  dispose(): void { this.interaction.dispose(); }
}
