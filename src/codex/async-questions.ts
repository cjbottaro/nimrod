import type { QuestionAnswer } from '../question-interaction';
import { isRecord } from '../json-rpc-connection';
import type { CodexItem } from './protocol';

export interface CodexAsyncQuestion {
  id: string;
  question: string;
  options: readonly string[];
}
interface Reply { questionItemId: string; question: string; answer: string; }
const OPEN = '<send_user_message_question_reply>';
const CLOSE = '</send_user_message_question_reply>';
const TEXT_LIMIT = 64 * 1024;

/** Codex 0.164.0's native client envelope, not an app-server RPC response. */
export function codexAsyncAnswer(question: CodexAsyncQuestion, answer: string): string {
  if (!answer.trim() || answer.length > TEXT_LIMIT) throw new Error('Enter a non-empty answer of at most 65536 characters.');
  // Match the native client's 512-byte, single-line question framing budget.
  let title = '', bytes = 0;
  const encoder = new TextEncoder();
  for (const char of question.question) {
    bytes += encoder.encode(char).length;
    if (bytes > 512) break;
    title += char;
  }
  return `${OPEN}\n${JSON.stringify([{ questionItemId: question.id, question: title.replace(/[\n\r]/g, ' '), answer }])}\n${CLOSE}`;
}

/** Recognize complete native reply envelopes only; never infer an answer from ordinary prose. */
export function codexAsyncReplies(text: string): readonly Reply[] | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(OPEN) || !trimmed.endsWith(CLOSE)) return;
  try {
    const raw: unknown = JSON.parse(trimmed.slice(OPEN.length, -CLOSE.length));
    const replies = Array.isArray(raw) ? raw : [raw];
    if (!replies.length || replies.length > 100 || !replies.every(reply => isRecord(reply)
      && typeof reply.questionItemId === 'string' && typeof reply.question === 'string' && typeof reply.answer === 'string')) return;
    return replies as Reply[];
  } catch { return; }
}
export function codexAsyncDisplay(text: string): string {
  return codexAsyncReplies(text)?.map(reply => `> ${reply.question}\n\n${reply.answer}`).join('\n\n') ?? text;
}

/** Session-owned optional follow-ups. Turn completion is deliberately not a retirement boundary. */
export class CodexAsyncQuestions {
  private readonly seen = new Set<string>();
  private readonly answered = new Set<string>();
  private readonly pending = new Map<string, AbortController>();
  constructor(private readonly host: {
    request(question: CodexAsyncQuestion, signal: AbortSignal): Promise<QuestionAnswer | undefined>;
    send(text: string): Promise<void>;
    error(message: string): void;
  }) {}

  offer(item: CodexItem): void {
    if (item.type !== 'agentMessage' || item.delivery !== 'async' || item.questions == null || this.seen.has(item.id)) return;
    this.seen.add(item.id);
    // Refuse unsupported/oversized semantics without disconnecting a valid conversation.
    if (!Array.isArray(item.questions) || !item.questions.length || item.questions.length > 100
      || item.questions.some(value => !isRecord(value) || Object.keys(value).some(key => key !== 'title' && key !== 'options')
        || typeof value.title !== 'string' || !value.title.trim() || value.title.length > TEXT_LIMIT
        || value.options != null && (!Array.isArray(value.options) || !value.options.length || value.options.length > 100
          || value.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 8192)))) {
      this.host.error('Codex sent unsupported async questions. The original question remains in the transcript; no answer was sent.'); return;
    }
    // Schedule the entire batch in order before processing answers. Each question is independently deliverable.
    item.questions.forEach((value, index) => {
      const id = JSON.stringify(['request_user_input_async', item.id, index]);
      if (this.answered.has(id) || this.answered.has(item.id)) return;
      const question: CodexAsyncQuestion = { id, question: value.title, options: value.options ?? [] };
      const controller = new AbortController(); this.pending.set(id, controller);
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        return this.host.request(question, controller.signal);
      }).then(answer => {
        if (controller.signal.aborted) return;
        this.pending.delete(id); this.answered.add(id);
        // Undefined is explicit Ignore, not an empty/default answer or an RPC cancellation.
        if (answer) return this.host.send(codexAsyncAnswer(question, answer.answer));
      }).catch(error => {
        if (!controller.signal.aborted) this.host.error(`Could not answer Codex question: ${String(error)}. Nothing was retried.`);
      }).finally(() => { this.pending.delete(id); controller.abort(); });
    });
  }

  reconcile(text: string): void {
    for (const reply of codexAsyncReplies(text) ?? []) {
      this.answered.add(reply.questionItemId);
      const controller = this.pending.get(reply.questionItemId);
      controller?.abort(); this.pending.delete(reply.questionItemId);
      // Older native clients used the source item ID for an entire batch.
      for (const [id, pending] of this.pending) {
        if (JSON.parse(id)[1] === reply.questionItemId) { pending.abort(); this.pending.delete(id); }
      }
    }
  }
  clear(): void {
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
  }
}
