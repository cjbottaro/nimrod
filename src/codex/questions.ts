import { RpcResponseError, isRecord, type RpcRecord } from '../json-rpc-connection';
import { nonempty, record } from './protocol';
export const CODEX_ANSWER_LIMIT = 64 * 1024;
export interface CodexQuestion {
  id: string; header: string; question: string; isOther: boolean; isSecret: false;
  options: readonly { label: string; description: string }[] | null;
}
export interface CodexQuestionRequest {
  threadId: string; turnId: string; itemId: string;
  questions: readonly CodexQuestion[]; isBlocking: boolean; autoResolutionMs: number | null;
}
export type CodexQuestionAnswers = Record<string, { answers: string[] }>;
function fields(value: RpcRecord, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RpcResponseError(-32601, 'This Codex question schema has unsupported fields');
}
/** Reviewed 0.162.0 experimental schema. Never infer arbitrary input/approval semantics. */
export function codexQuestionRequest(value: RpcRecord): CodexQuestionRequest {
  try {
    fields(value, ['threadId', 'turnId', 'itemId', 'questions', 'isBlocking', 'autoResolutionMs']);
    const threadId = nonempty(value.threadId, 'question thread ID'), turnId = nonempty(value.turnId, 'question turn ID'), itemId = nonempty(value.itemId, 'question item ID');
    if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 3 || typeof value.isBlocking !== 'boolean') throw new Error('Expected 1–3 Codex questions with blocking metadata');
    if (value.autoResolutionMs != null && (typeof value.autoResolutionMs !== 'number' || !Number.isSafeInteger(value.autoResolutionMs) || value.autoResolutionMs < 0)) throw new Error('Invalid Codex question timeout metadata');
    const ids = new Set<string>();
    const questions = value.questions.map(raw => {
      const question = record(raw, 'question'); fields(question, ['id', 'header', 'question', 'isOther', 'isSecret', 'options']);
      const id = nonempty(question.id, 'question ID');
      if (id.length > 128 || ids.has(id)) throw new Error('Invalid or duplicate Codex question ID'); ids.add(id);
      if (typeof question.header !== 'string' || question.header.length > 512 || typeof question.question !== 'string' || !question.question.trim() || question.question.length > 64 * 1024
        || typeof question.isOther !== 'boolean' || typeof question.isSecret !== 'boolean') throw new Error('Invalid Codex question fields');
      if (question.isSecret) throw new RpcResponseError(-32601, 'Codex requested secret input, which Nimrod does not collect through its ordinary question dialog');
      let options: { label: string; description: string }[] | null = null;
      if (question.options !== null) {
        if (!Array.isArray(question.options) || !question.options.length || question.options.length > 100) throw new Error('Invalid Codex question options');
        const labels = new Set<string>();
        options = question.options.map(raw => {
          const option = record(raw, 'question option'); fields(option, ['label', 'description']);
          const label = nonempty(option.label, 'question option label');
          if (label.length > 8192 || labels.has(label) || typeof option.description !== 'string' || option.description.length > 16 * 1024) throw new Error('Invalid or duplicate Codex question option');
          labels.add(label); return { label, description: option.description };
        });
      }
      return { id, header: question.header, question: question.question, isOther: question.isOther, isSecret: false as const, options };
    });
    return { threadId, turnId, itemId, questions, isBlocking: value.isBlocking, autoResolutionMs: typeof value.autoResolutionMs === 'number' ? value.autoResolutionMs : null };
  } catch (error) { throw error instanceof RpcResponseError ? error : new RpcResponseError(-32602, error instanceof Error ? error.message : 'Invalid Codex question'); }
}
export function codexQuestionAnswers(request: CodexQuestionRequest, value: unknown): CodexQuestionAnswers {
  if (!isRecord(value) || Object.keys(value).length !== request.questions.length) throw new RpcResponseError(-32602, 'Codex requires an explicit answer for every requested question');
  return Object.fromEntries(request.questions.map(question => {
    const answer = Object.hasOwn(value, question.id) ? value[question.id] : undefined;
    if (!isRecord(answer) || !Array.isArray(answer.answers) || answer.answers.length !== 1) throw new RpcResponseError(-32602, 'Unsupported Codex answer shape');
    const text = answer.answers[0];
    if (typeof text !== 'string' || !text.trim() || text.length > CODEX_ANSWER_LIMIT || question.options && !question.isOther && !question.options.some(option => option.label === text))
      throw new RpcResponseError(-32602, 'Answer was not offered or is invalid for this Codex question');
    return [question.id, { answers: [text] }];
  }));
}
