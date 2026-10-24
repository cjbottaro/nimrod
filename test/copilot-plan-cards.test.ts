import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { copilotToolResult } from '../src/copilot/tool-result';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';

// Scrubbed CLI 1.0.100 exit_plan_mode shapes observed October 19, 2026 (local time).
const source = { backend: 'copilot-sdk' as const, agent: 'Copilot' };
const input = { summary: '- Preserve **drafts**.\n- Implement the approved workflow.', recommendedAction: 'interactive' };
const outcome = '✅ Plan approved, exited plan mode (autopilot)';
const result = { content: 'Plan approved! Exited plan mode.\n\nYou are now in autopilot mode. Proceed with implementing the plan now.', detailedContent: outcome };
function data(): ToolCardData {
  return { source, name: 'exit_plan_mode', title: 'Exiting plan mode', kind: 'other', toolStatus: 'result', arguments: input,
    native: { 'tool.execution_start': { toolName: 'exit_plan_mode', arguments: input }, 'tool.execution_complete': { success: true, result } },
    resultOutput: copilotToolResult(result) };
}
function fixture(block = data()) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const markdown = createSafeMarkdownRenderer(dom.window as unknown as Window);
  const card = renderToolCard(doc, block, doc.createElement('details'), undefined, undefined, { markdown(source) {
    const node = doc.createElement('div'); node.className = 'markdown'; node.innerHTML = markdown.render(source); return node;
  } }); doc.body.append(card);
  return { dom, doc, card, close() { disposeToolCard(card); dom.window.close(); } };
}

test('completed plan review uses the native outcome and a disclosed Markdown summary without interactive controls', () => {
  const f = fixture();
  try {
    assert.equal(f.card.open, false);
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Plan review');
    assert.equal(f.card.querySelector('.card-question-reply')?.textContent, outcome);
    assert.equal(f.card.querySelector('[data-output-kind="plan-summary"] strong')?.textContent, 'drafts');
    assert.equal(f.card.querySelector('button, textarea, input'), null);
    assert.equal(f.card.querySelector('.tool-raw-output pre')?.textContent, copilotToolResult(result));
    assert.deepEqual(JSON.parse(f.card.querySelector('.tool-raw-inputs pre')!.textContent!), input);
    assert.doesNotMatch(f.card.querySelector('summary')!.textContent!, /Proceed with implementing/);
  } finally { f.close(); }
});

test('plan enhancement retains mounted summary, raw disclosure, focus and unchanged output nodes', () => {
  const block = data(), f = fixture({ ...block, toolStatus: 'running', resultOutput: undefined, native: {} });
  try {
    const summary = f.card.querySelector('summary')!;
    const raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    f.card.open = true; raw.open = true; summary.focus();
    updateToolCard(f.doc, f.card, block);
    assert.equal(f.card.querySelector('summary'), summary); assert.equal(f.doc.activeElement, summary);
    assert.equal(f.card.open, true); assert.equal(f.card.querySelector('.tool-raw-inputs'), raw); assert.equal(raw.open, true);
    const reply = f.card.querySelector('.card-question-reply'), plan = f.card.querySelector('[data-output-kind="plan-summary"] .tool-output');
    updateToolCard(f.doc, f.card, block);
    assert.equal(f.card.querySelector('.card-question-reply'), reply);
    assert.equal(f.card.querySelector('[data-output-kind="plan-summary"] .tool-output'), plan);
  } finally { f.close(); }
});

test('plan errors, interruptions, unrelated MCP tools and missing native detail retain generic literal recovery', () => {
  const base = data();
  for (const block of [
    { ...base, isError: true }, { ...base, uiPhase: 'stopped' as const }, { ...base, toolStatus: 'running' as const },
    { ...base, native: {} }, { ...base, resultOutput: 'Different output' },
    { ...base, native: { 'tool.execution_complete': { success: false, result } } },
    { ...base, native: { 'tool.execution_complete': { success: true, result: { content: 'Plan approved!' } } }, resultOutput: copilotToolResult({ content: 'Plan approved!' }) },
    { ...base, native: { ...(base.native as object), 'tool.execution_start': { mcpServerName: 'other', mcpToolName: 'exit_plan_mode' } } },
    { ...base, source: { backend: 'acp' as const, agent: 'Copilot' } },
  ]) {
    const f = fixture(block);
    try { assert.equal(f.card.querySelector('.card-question-reply'), null); assert.ok(f.card.textContent!.includes(block.resultOutput!)); }
    finally { f.close(); }
  }
});
