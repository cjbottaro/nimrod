import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { editPreviewRenderer } from '../src/pi/card-plugins/edit';
import { renderToolCard, updateToolCard } from '../src/pi/tool-card';

test('edit renderer uses real structured substitutions and labels them as requested, never applied', () => {
  const renderer = editPreviewRenderer.mount();
  const single = renderer.update({ name: 'edit', arguments: { path: 'a.ts', oldText: 'old', newText: 'new' } });
  assert.equal(single.preview, 'a.ts');
  assert.equal(single.sections[0].text, '-old\n+new');
  assert.match(single.sections[0].label, /not an applied-file diff/);
  const multi = renderer.update({ name: 'edit', arguments: { path: 'a.ts', edits: [
    { oldText: '', newText: 'insert' }, { oldText: 'delete', newText: '' }, { oldText: 'old', newText: 1 },
  ] }, toolStatus: 'result', resultOutput: 'Pi result' });
  assert.deepEqual(multi.sections.map(section => section.text), ['+insert', '-delete', 'Pi result']);
  assert.equal(renderer.update({ name: 'edit', arguments: '{"oldText":"partial' }).sections.length, 0);
  renderer.dispose();
});

test('edit card keeps raw inputs/results and literal safe diff nodes through streaming, failure and history', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const data = { name: 'functions.edit', arguments: { path: 'a.ts', edits: [{ oldText: '<script>bad</script>', newText: '<img onerror=bad>\nnext' }] } };
    const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card);
    const output = card.querySelector('[data-output-kind="requested-edit:0"] .tool-output');
    const raw = card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    raw.open = true; card.open = true;
    updateToolCard(doc, card, { ...data, toolStatus: 'running', executionOutput: 'work' });
    assert.equal(card.querySelector('[data-output-kind="requested-edit:0"] .tool-output'), output);
    assert.equal(card.querySelector('script, img'), null);
    assert.match(output?.textContent || '', /-<script>bad<\/script>\n\+<img onerror=bad>/);
    assert.ok(output?.querySelector('.hljs-addition'));
    assert.ok(output?.querySelector('.hljs-deletion'));
    updateToolCard(doc, card, { ...data, toolStatus: 'result', resultOutput: 'Rejected: not found', isError: true });
    assert.equal(card.querySelector('[data-output-kind="result"] .tool-output')?.textContent, 'Rejected: not found');
    assert.equal(card.querySelector('.tool-raw-inputs'), raw); assert.equal(raw.open, true);
    assert.equal(card.open, true);
    assert.match(card.querySelector('summary')?.getAttribute('aria-label') || '', /failed/);
    const historical = renderToolCard(doc, { ...data, toolStatus: 'result', resultOutput: 'Saved result' }, doc.createElement('details'));
    assert.match(historical.textContent || '', /Requested edit/);
    assert.match(historical.textContent || '', /Saved result/);
  } finally { dom.window.close(); }
});
