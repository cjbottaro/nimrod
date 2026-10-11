import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { validatePresentation } from '../src/pi/card-renderer';
import { defaultToolRenderer } from '../src/pi/card-plugins/tool';
import { defaultReasoningRenderer } from '../src/pi/card-plugins/reasoning';
import { defaultParallelRenderer } from '../src/pi/card-plugins/parallel';
import { renderParallelToolCard, disposeParallelCard } from '../src/pi/parallel-card';

test('bundled tool, reasoning and parallel renderers use the same validated instance contract without DOM access', () => {
  const tool = defaultToolRenderer.mount();
  const reasoning = defaultReasoningRenderer.mount();
  const parallel = defaultParallelRenderer.mount();
  assert.equal(validatePresentation(tool.update({ name: 'read', arguments: { path: 'a.ts' }, toolStatus: 'result', resultOutput: 'raw' })).preview, 'a.ts');
  assert.equal(validatePresentation(reasoning.update('\nFirst\nMore')).sections[0].format, 'markdown');
  assert.equal(validatePresentation(parallel.update({ id: 'p', tools: [{ id: 'a', name: 'read', status: 'running', arguments: { path: 'a.ts' } }] })).members?.[0].preview, 'a.ts');
  tool.dispose(); reasoning.dispose(); parallel.dispose();
});

test('parallel renderer updates retain connected members/indicator, manual disclosure and prune removed members', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const a = { id: 'a', name: 'read', status: 'running' as const, arguments: { path: 'a.ts' } };
    const b = { id: 'b', name: 'bash', status: 'running' as const, arguments: { command: 'pwd' } };
    const card = renderParallelToolCard(doc, { id: 'p', tools: [a, b] }); doc.body.append(card);
    const row = card.querySelector('[data-tool-id="a"]');
    const indicator = card.querySelector('.parallel-indicator');
    const memberIndicator = row?.querySelector('.member-indicator');
    card.open = false;
    renderParallelToolCard(doc, { id: 'p', tools: [b, { ...a, status: 'done' }] }, card);
    assert.equal(card.querySelector('[data-tool-id="a"]'), row);
    assert.equal(row?.querySelector('.member-indicator'), memberIndicator);
    assert.equal(card.querySelector('.parallel-indicator'), indicator);
    assert.equal(card.open, false);
    renderParallelToolCard(doc, { id: 'p', tools: [a] }, card);
    assert.equal(card.querySelector('[data-tool-id="b"]'), null);
    disposeParallelCard(card); disposeParallelCard(card);
  } finally { dom.window.close(); }
});
