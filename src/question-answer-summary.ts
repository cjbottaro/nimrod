/** Shared read-only question/reply visuals; no harness, delivery or decision semantics. */
export function updateQuestionAnswerSummary(summary: HTMLElement, value?: { question: string; answer: string }): void {
  const document = summary.ownerDocument;
  summary.classList.toggle('card-question-answer', value !== undefined);
  let icon = summary.querySelector('.card-question-icon');
  let reply = summary.querySelector<HTMLElement>('.card-question-reply');
  if (!value) { summary.removeAttribute('aria-label'); icon?.remove(); reply?.remove(); return; }
  let title = summary.querySelector<HTMLElement>('.tool-card-title');
  if (!title) { title = document.createElement('span'); title.className = 'tool-card-title'; summary.append(title); }
  if (title.textContent !== value.question) title.textContent = value.question;
  summary.setAttribute('aria-label', `Question: ${value.question}. Answer: ${value.answer}`);
  if (!icon) {
    icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'card-question-icon'); icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z');
    icon.append(path); summary.prepend(icon);
  }
  if (!reply) { reply = document.createElement('span'); reply.className = 'card-question-reply'; summary.append(reply); }
  if (reply.textContent !== value.answer) reply.textContent = value.answer;
}
