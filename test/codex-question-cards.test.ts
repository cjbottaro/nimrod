import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { codexInteraction } from '../src/codex/view-policy';
import { codexAsyncAnswer } from '../src/codex/async-questions';
import { updateQuestionAnswerSummary } from '../src/question-answer-summary';

const question = { id: JSON.stringify(['request_user_input_async', 'call', 0]), question: 'Which scope?', options: [] };
function fixture() {
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true }), document = dom.window.document;
  const interaction = codexInteraction(() => undefined), expanded = new Map<string, boolean>();
  return { dom, document, expanded, render(text: string, previous?: HTMLElement) {
    return interaction.userText!(document, text, 'user-answer', expanded, () => { throw new Error('Question/answer text must remain literal'); }, previous);
  } };
}

test('Codex async answer user text uses the same question/reply primitive as Copilot, with exact raw recovery', () => {
  const f = fixture();
  try {
    const text = codexAsyncAnswer(question, '  Selected scope\nwith detail  '), node = f.render(text)!;
    f.document.body.append(node);
    const card = node.querySelector<HTMLDetailsElement>('.codex-answer-card')!;
    assert.equal(card.open, false);
    assert.equal(card.querySelector('.tool-card-title')!.textContent, question.question);
    assert.equal(card.querySelector('.card-question-reply')!.textContent, '  Selected scope\nwith detail  ');
    assert.equal(card.querySelector('.card-question-icon')!.getAttribute('aria-hidden'), 'true');
    assert.equal(card.querySelector('.card-question-icon')!.getAttribute('focusable'), 'false');
    assert.equal(card.querySelector('pre')!.textContent, text);
    assert.equal(card.querySelector('button, textarea, input, .tool-card-dot'), null);
    const shared = f.document.createElement('span'); shared.className = 'card-plugin-summary';
    updateQuestionAnswerSummary(shared, { question: question.question, answer: '  Selected scope\nwith detail  ' });
    assert.equal(card.querySelector('.card-plugin-summary')!.innerHTML, shared.innerHTML);
  } finally { f.dom.window.close(); }
});

test('Codex question cards preserve literal markup, support native batch/legacy object replies, and leave ordinary user text alone', () => {
  const f = fixture();
  try {
    const question = '<img src=x onerror=alert(1)>\n**Literal question**', answer = '<script>literal</script>\n  [not a link](https://example.com)  ';
    for (const replies of [{ questionItemId: 'legacy', question, answer }, [{ questionItemId: 'first', question, answer }, { questionItemId: 'second', question: 'Second?', answer: 'B' }]]) {
      const text = `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`, root = f.render(text)!;
      assert.equal(root.querySelector('.card-question-reply')!.textContent, answer);
      assert.equal(root.querySelector('.tool-card-title')!.textContent, question);
      assert.equal(root.querySelector('script, img, a, strong'), null);
      assert.equal(root.querySelectorAll('.card-question-answer').length, Array.isArray(replies) ? 2 : 1);
      assert.equal(root.querySelectorAll('pre').length, 1, 'batch answers share one exact raw envelope');
    }
    for (const text of ['Ordinary message', '> Question?\n\nAnswer', '<send_user_message_question_reply>broken</send_user_message_question_reply>']) assert.equal(f.render(text), undefined);
  } finally { f.dom.window.close(); }
});

test('the extracted shared summary retains title/icon/reply nodes and clears cleanly for generic tool fallback', () => {
  const dom = new JSDOM('<body></body>'), document = dom.window.document, summary = document.createElement('span');
  try {
    updateQuestionAnswerSummary(summary, { question: 'Q', answer: 'A' });
    const title = summary.querySelector('.tool-card-title'), icon = summary.querySelector('.card-question-icon'), reply = summary.querySelector('.card-question-reply');
    updateQuestionAnswerSummary(summary, { question: 'Q2', answer: 'A2' });
    assert.equal(summary.querySelector('.tool-card-title'), title); assert.equal(summary.querySelector('.card-question-icon'), icon); assert.equal(summary.querySelector('.card-question-reply'), reply);
    assert.equal(title!.textContent, 'Q2'); assert.equal(reply!.textContent, 'A2');
    updateQuestionAnswerSummary(summary);
    assert.equal(summary.classList.contains('card-question-answer'), false); assert.equal(summary.getAttribute('aria-label'), null);
    assert.equal(summary.querySelector('.card-question-icon, .card-question-reply'), null); assert.equal(summary.querySelector('.tool-card-title'), title);
  } finally { dom.window.close(); }
});
