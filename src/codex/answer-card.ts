import { codexAsyncReplies } from './async-questions';
import { updateQuestionAnswerSummary } from '../question-answer-summary';
import { createCardSummary, createToolDetails } from '../pi/card-shell';

/** Codex answers remain user messages, not invented tools or RPC results. */
export function renderCodexAnswerCards(document: Document, text: string, key: string, expanded: Map<string, boolean>, previous?: HTMLElement): HTMLElement | undefined {
  const replies = codexAsyncReplies(text);
  if (!replies) return;
  const root = previous?.classList.contains('codex-answer-cards') ? previous : document.createElement('div');
  root.className = 'codex-answer-cards';
  let card = root.querySelector<HTMLDetailsElement>('.codex-answer-card');
  if (!card) {
    card = createToolDetails(document, expanded, `${key}:answer`);
    card.className = 'tool-card codex-answer-card';
    const summary = createCardSummary(document);
    const exchanges = document.createElement('span'); exchanges.className = 'codex-answer-exchanges'; summary.append(exchanges);
    const label = document.createElement('div'); label.className = 'tool-label'; label.textContent = 'Raw message';
    const raw = document.createElement('pre'); raw.className = 'tool-output tool-output-final'; raw.tabIndex = 0;
    raw.setAttribute('aria-label', 'Raw Codex answer message');
    card.append(summary, label, raw); root.append(card);
  }
  const summary = card.querySelector<HTMLElement>('summary')!;
  const exchanges = summary.querySelector<HTMLElement>('.codex-answer-exchanges')!;
  const existing = new Map(Array.from(exchanges.children).map(node => [(node as HTMLElement).dataset.replyKey, node as HTMLElement]));
  replies.forEach((reply, index) => {
    const replyKey = JSON.stringify([reply.questionItemId, index]);
    let content = existing.get(replyKey);
    if (!content) { content = document.createElement('span'); content.className = 'card-plugin-summary'; content.dataset.replyKey = replyKey; }
    existing.delete(replyKey);
    updateQuestionAnswerSummary(content, { question: reply.question, answer: reply.answer });
    if (exchanges.children[index] !== content) exchanges.insertBefore(content, exchanges.children[index] ?? null);
  });
  for (const content of existing.values()) content.remove();
  summary.setAttribute('aria-label', replies.map(reply => `Question: ${reply.question}. Answer: ${reply.answer}`).join('. '));
  // Keep one exact raw envelope per user message, not one full copy per answer in a batch.
  const raw = card.querySelector('pre')!;
  if (raw.textContent !== text) raw.textContent = text;
  return root;
}
