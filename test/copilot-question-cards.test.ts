import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import type { ToolCardData } from '../src/card-plugin-api';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { validatePresentation } from '../src/pi/card-renderer';
import { questionAnswerPresentation } from '../src/card-plugin-ui';
import { copilotToolResult } from '../src/copilot/tool-result';

// Scrubbed native ask_user start/completion shapes observed in local Copilot history
// on October 17–18, 2026: simple question/choices and older schema elicitation.
const source = { backend: 'copilot-sdk' as const, agent: 'Copilot' };
const question = 'What scope do you want for the first pass?';
const answer = 'Work through the design before implementing';
const choices = ['Conversation and code fonts/sizes (Recommended)', 'Include interface typography', answer];
function data(input: unknown = { question, choices }, result: Record<string, unknown> = { content: `User selected: ${answer}` }): ToolCardData {
  return { source, name: 'ask_user', kind: 'other', title: 'Asking user', toolStatus: 'result', arguments: input,
    native: { 'tool.execution_start': { toolName: 'ask_user', arguments: input }, 'tool.execution_complete': { success: true, result } },
    resultOutput: copilotToolResult(result) };
}
function fixture(block: ToolCardData) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const card = renderToolCard(doc, block, doc.createElement('details')); doc.body.append(card);
  return { dom, doc, card, close() { disposeToolCard(card); dom.window.close(); } };
}

test('completed native questions show only the question and reply in the closed summary', () => {
  const block = data(), f = fixture(block);
  try {
    assert.equal(f.card.open, false);
    const summary = f.card.querySelector('summary')!;
    assert.equal(summary.querySelector('.tool-card-title')?.textContent, question);
    assert.equal(summary.querySelector('.card-question-reply')?.textContent, answer);
    assert.equal(summary.querySelector('.card-question-icon')?.getAttribute('aria-hidden'), 'true');
    assert.equal(summary.querySelector('.card-question-icon')?.getAttribute('focusable'), 'false');
    assert.match(summary.getAttribute('aria-label')!, /Question:.*Answer:.*succeeded/);
    assert.ok(!summary.textContent!.includes('Asking user'));
    assert.ok(!summary.textContent!.includes('Recommended'));
    assert.equal(f.card.querySelector('[title]'), null);
    assert.equal(f.card.querySelector('button, textarea, input'), null, 'the card never answers a request');
    assert.equal(f.card.querySelector('[data-output-kind="question-options"] .tool-output')?.textContent, choices.join('\n'));
    assert.deepEqual(JSON.parse(f.card.querySelector('.tool-raw-inputs pre')!.textContent!), block.arguments);
    assert.equal(f.card.querySelector('.tool-raw-output pre')?.textContent, block.resultOutput);
    assert.equal(f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')?.open, false);
  } finally { f.close(); }
});

test('freeform replies preserve literal multiline text and never interpret markup', () => {
  const reply = '  <img src=x onerror=alert(1)>\nKeep **this** literal.  ';
  const f = fixture(data({ question: '<script>question</script>' }, { content: `User responded: ${reply}` }));
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, '<script>question</script>');
    assert.equal(f.card.querySelector('.card-question-reply')?.textContent, reply);
    assert.equal(f.card.querySelector('script, img'), null);
    assert.equal(f.card.querySelector('[data-output-kind="question-options"]'), null);
  } finally { f.close(); }
});

test('older schema questions retain labelled answers and disclose enum/oneOf choices', () => {
  const f = fixture(data({ message: 'Choose the scope and workflow.', requestedSchema: { properties: {
    scope: { title: 'Scope', enum: ['Persistence and lifecycle', 'Persistence only'] },
    workflow: { title: 'Workflow', oneOf: [{ const: 'design', title: 'Design first' }, { const: 'implement', title: 'Implement now' }] },
  } } }, { content: 'User responded: Persistence and lifecycle', detailedContent: 'User responded:\nscope: Persistence and lifecycle\nworkflow: Design first' }));
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Choose the scope and workflow.');
    assert.equal(f.card.querySelector('.card-question-reply')?.textContent, 'scope: Persistence and lifecycle\nworkflow: Design first');
    const options = f.card.querySelector('[data-output-kind="question-options"]')!.textContent!;
    for (const text of ['Scope', 'Persistence only', 'Workflow', 'Design first', 'Implement now']) assert.ok(options.includes(text));
  } finally { f.close(); }
});

test('generation through completion enhances the existing shell without disturbing manual disclosure or raw focus', () => {
  const complete = data();
  const f = fixture({ source, kind: 'other', toolStatus: 'running', arguments: '{"question":' });
  try {
    const summary = f.card.querySelector('summary'), body = f.card.querySelector('.card-plugin-body');
    const rawInputs = f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    f.card.open = true; rawInputs.open = true; summary!.focus();
    updateToolCard(f.doc, f.card, { ...complete, toolStatus: 'running', native: {}, resultOutput: undefined });
    assert.equal(f.card.querySelector('.card-question-reply'), null, 'pending decisions keep their existing presentation');
    updateToolCard(f.doc, f.card, complete);
    assert.equal(f.card.querySelector('summary'), summary); assert.equal(f.card.querySelector('.card-plugin-body'), body);
    assert.equal(f.card.querySelector('.tool-raw-inputs'), rawInputs); assert.equal(rawInputs.open, true);
    assert.equal(f.card.open, true); assert.equal(f.doc.activeElement, summary);
    const reply = f.card.querySelector('.card-question-reply'), icon = f.card.querySelector('.card-question-icon');
    const options = f.card.querySelector<HTMLElement>('[data-output-kind="question-options"] .tool-output')!;
    const rawOutput = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    const indicator = f.card.querySelector('.tool-card-dot');
    rawOutput.open = true; options.focus(); options.scrollTop = 31;
    updateToolCard(f.doc, f.card, complete);
    assert.equal(f.card.querySelector('.card-question-reply'), reply); assert.equal(f.card.querySelector('.card-question-icon'), icon);
    assert.equal(f.card.querySelector('.tool-card-dot'), indicator);
    assert.equal(f.card.querySelector('[data-output-kind="question-options"] .tool-output'), options);
    assert.equal(f.doc.activeElement, options); assert.equal(options.scrollTop, 31);
    assert.equal(f.card.querySelector('.tool-raw-output'), rawOutput); assert.equal(rawOutput.open, true);
  } finally { f.close(); }
});

test('cancellation, failure, interruption, unknown results and unrelated sources never masquerade as answered', () => {
  const base = data();
  for (const block of [
    data(undefined, { content: 'User cancelled the request.' }),
    data(undefined, { content: 'User not available.' }),
    data(undefined, { content: 'Unexpected result' }),
    data(undefined, { content: 'User responded: ' }),
    { ...base, toolStatus: 'running' as const },
    { ...base, isError: true }, { ...base, uiPhase: 'stopped' as const },
    { ...base, arguments: {} }, { ...base, name: 'some_other_tool' },
    { ...base, source: { backend: 'acp' as const, agent: 'Copilot' } },
    { ...base, source: undefined },
    { ...base, native: { 'tool.execution_complete': { success: false, result: { content: `User selected: ${answer}` } } } },
    { ...base, native: {} }, { ...base, resultOutput: 'Unrelated current output' },
    { ...base, native: { ...(base.native as object), 'tool.execution_start': { mcpServerName: 'unrelated', mcpToolName: 'ask_user' } } },
  ]) {
    const f = fixture(block);
    try {
      assert.equal(f.card.querySelector('.card-question-answer'), null);
      assert.ok(f.card.textContent!.includes(block.resultOutput || 'Asking user'));
    } finally { f.close(); }
  }
});

test('question/reply presentation is public, validates its optional field and clears on generic fallback', async () => {
  assert.throws(() => validatePresentation({ title: 'Q', sections: [], questionAnswer: { answer: 42 } } as never), /Invalid card/);
  const presentation = questionAnswerPresentation({ question: 'Q', answer: 'A', sections: [] });
  assert.deepEqual(validatePresentation(presentation).questionAnswer, { answer: 'A' });
  const bundle = await build({ stdin: { contents: `export { questionAnswerPresentation } from './src/card-plugin-ui';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const external = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.deepEqual(external.questionAnswerPresentation({ question: 'Q', answer: 'A', sections: [] }), presentation);
  const f = fixture(data());
  try {
    updateToolCard(f.doc, f.card, { ...data(), isError: true });
    assert.equal(f.card.querySelector('.card-question-answer, .card-question-icon, .card-question-reply'), null);
    assert.equal(f.card.querySelector('.card-plugin-summary')?.getAttribute('aria-label'), null);
    assert.match(f.card.querySelector('summary')!.getAttribute('aria-label')!, /Asking user.*failed/);
  } finally { f.close(); }
});
