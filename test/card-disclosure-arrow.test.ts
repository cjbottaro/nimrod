import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { createCardSummary, createToolDetails } from '../src/pi/card-shell';
import { renderToolCard, updateToolCard } from '../src/pi/tool-card';
import { renderReasoningCard, updateReasoningCard } from '../src/pi/reasoning-card';
import { renderParallelToolCard } from '../src/pi/parallel-card';
import { renderSkillInvocation } from '../src/skill-invocation';

function arrow(summary: Element): Element {
  const svg = summary.firstElementChild!;
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.ok(svg.classList.contains('card-disclosure-arrow'));
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 100');
  assert.equal(svg.querySelector('path')?.getAttribute('d'), 'M15 0 L85 50 L15 100 Z');
  assert.equal(summary.querySelectorAll('.card-disclosure-arrow').length, 1);
  return svg;
}

test('card summaries paint a decorative triangle without adding accessible text', () => {
  const doc = new JSDOM().window.document;
  const summary = createCardSummary(doc, 'Raw inputs');
  arrow(summary);
  assert.equal(summary.textContent, 'Raw inputs');
  assert.equal(summary.hasAttribute('tabindex'), false);
});

test('all card shells use retained SVG arrows outside plugin-owned content', () => {
  const doc = new JSDOM().window.document;
  const render = (text: string) => { const node = doc.createElement('div'); node.textContent = text; return node; };
  const block = { name: 'custom', arguments: { value: 1 }, toolStatus: 'running' as const, executionOutput: 'output' };
  const tool = renderToolCard(doc, block, createToolDetails(doc, new Map(), 'tool'),
    { id: 'fixture', supports: () => true, mount: () => ({
      update: () => ({ title: 'Custom', sections: [] }), dispose() {},
    }) });
  doc.body.append(tool);
  const summaries = Array.from(tool.querySelectorAll('summary'));
  // Tool shell, raw inputs and plugin-omitted raw output recovery.
  assert.equal(summaries.length, 3);
  const arrows = summaries.map(arrow);
  tool.open = true;
  updateToolCard(doc, tool, { ...block, toolStatus: 'result', resultOutput: 'final' });
  summaries.forEach((summary, i) => assert.equal(arrow(summary), arrows[i]));
  assert.equal(tool.open, true);
  assert.equal(tool.querySelector('.card-plugin-summary .card-disclosure-arrow'), null);

  const reasoning = renderReasoningCard(doc, new Map(), 'reasoning', 'Thinking', render, true)!;
  const reasoningArrow = arrow(reasoning.querySelector('summary')!);
  updateReasoningCard(reasoning, 'Done', render, false);
  assert.equal(arrow(reasoning.querySelector('summary')!), reasoningArrow);

  const cluster = { id: 'parallel', tools: [] };
  const parallel = renderParallelToolCard(doc, cluster);
  const parallelArrow = arrow(parallel.querySelector('summary')!);
  renderParallelToolCard(doc, cluster, parallel);
  assert.equal(arrow(parallel.querySelector('summary')!), parallelArrow);

  for (const label of ['/skill:review', '/review']) {
    const skill = renderSkillInvocation(doc, { label, location: '/fixture/SKILL.md', content: 'Instructions' }, 'skill', new Map(), render);
    arrow(skill.querySelector('summary')!);
    assert.equal(skill.querySelector('summary')!.textContent, label);
  }
});

test('input and output disclosure labels update without removing SVG arrows', () => {
  const doc = new JSDOM().window.document;
  const block = { name: 'custom', arguments: { code: 'return 1' }, toolStatus: 'running' as const, executionOutput: 'one' };
  const tool = renderToolCard(doc, block, createToolDetails(doc, new Map(), 'tool'), {
    id: 'disclosure-fixture', supports: () => true, mount: () => ({
      update: (data: Readonly<ToolCardData>) => ({ title: 'Custom', inputDisclosure: { label: 'Script', field: 'code' },
        outputDisclosure: data.toolStatus === 'result' ? 'Final output' : 'Output',
        sections: [{ key: 'execution', label: 'Output', text: data.executionOutput || '' }] }),
      dispose() {},
    }),
  });
  const input = tool.querySelector<HTMLDetailsElement>(':scope > .tool-raw-inputs')!;
  const output = tool.querySelector<HTMLDetailsElement>('.card-output-disclosure')!;
  const inputSummary = input.querySelector('summary')!, outputSummary = output.querySelector('summary')!;
  const inputArrow = arrow(inputSummary), outputArrow = arrow(outputSummary);
  assert.equal(inputSummary.textContent, 'Script');
  assert.equal(outputSummary.textContent, 'Output');
  input.open = output.open = true;
  updateToolCard(doc, tool, { ...block, arguments: { code: 'return 2', extra: true }, toolStatus: 'result' });
  assert.equal(inputSummary.textContent, 'Raw inputs');
  assert.equal(outputSummary.textContent, 'Final output');
  assert.equal(arrow(inputSummary), inputArrow);
  assert.equal(arrow(outputSummary), outputArrow);
  assert.equal(input.open, true);
  assert.equal(output.open, true);
});
