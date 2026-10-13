import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { editPreviewRenderer } from '../src/pi/card-plugins/edit';
import { editDiff } from '../src/pi/card-plugins/edit-diff';
import { validatePresentation } from '../src/pi/card-renderer';
import { renderToolCard, updateToolCard } from '../src/pi/tool-card';

test('edit renderer uses input-backed substitutions with change counts, never applied-file claims', () => {
  const renderer = editPreviewRenderer.mount();
  const single = renderer.update({ name: 'edit', arguments: { path: 'a.ts', oldText: 'old', newText: 'new' } });
  assert.equal(single.preview, 'a.ts');
  assert.equal(single.sections[0].text, '-old\n+new');
  assert.equal(single.sections[0].label, '+1 −1');
  assert.equal(single.rawInputsPlacement, 'after');
  const multi = renderer.update({ name: 'edit', arguments: { path: 'a.ts', edits: [
    { oldText: '', newText: 'insert' }, { oldText: 'delete', newText: '' }, { oldText: 'old', newText: 1 },
  ] }, toolStatus: 'result', resultOutput: 'Pi result' });
  assert.deepEqual(multi.sections.map(section => section.text), ['+insert', '-delete']);
  assert.deepEqual(multi.sections.map(section => section.label), ['1 of 2 · +1 −0', '2 of 2 · +0 −1']);
  assert.equal(renderer.update({ name: 'edit', arguments: '{"oldText":"partial' }).sections.length, 0);
  renderer.dispose();
});

test('line diffs preserve shared context and exact inserted/deleted blank lines', () => {
  assert.deepEqual(editDiff('## Tests\n\nEnd', '## Tests\n\nAdded\n\nEnd'), {
    text: ' ## Tests\n \n+Added\n+\n End', added: 2, removed: 0,
  });
  assert.deepEqual(editDiff('a\nold\nshared\nlast', 'a\nnew\nshared\nlast'), {
    text: ' a\n-old\n+new\n shared\n last', added: 1, removed: 1,
  });
  assert.deepEqual(editDiff('', ''), { text: '', added: 0, removed: 0 });
  assert.deepEqual(editDiff('same\n', 'same\n'), { text: ' same\n ', added: 0, removed: 0 });
  assert.deepEqual(editDiff('a\n', 'a'), { text: ' a\n-', added: 0, removed: 1 });
  assert.deepEqual(editDiff('', '\n'), { text: '+\n+', added: 2, removed: 0 });
  const old = Array.from({ length: 600 }, (_, i) => `old ${i}`);
  const fresh = old.map(line => line.replace('old', 'new'));
  const large = editDiff(['head', ...old, 'tail'].join('\n'), ['head', ...fresh, 'tail'].join('\n'));
  assert.equal(large.added, 600); assert.equal(large.removed, 600);
  assert.equal(large.text, [' head', ...old.map(line => `-${line}`), ...fresh.map(line => `+${line}`), ' tail'].join('\n'));
});

test('raw input placement is a validated public presentation option', () => {
  assert.equal(validatePresentation({ title: 'fixture', sections: [], rawInputsPlacement: 'after' }).rawInputsPlacement, 'after');
  assert.throws(() => validatePresentation({ title: 'fixture', sections: [], rawInputsPlacement: 'invalid' as 'after' }), /Invalid card presentation/);
});

test('edit controls, wrap state and raw disclosure survive lifecycle updates and malformed input fallback', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const data = { name: 'edit', arguments: { path: 'deep/folder/a.ts', oldText: 'head\nold\ntail', newText: 'head\nnew\ntail' } };
    const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card); card.open = true;
    const button = card.querySelector<HTMLButtonElement>('.edit-card-wrap')!;
    const output = card.querySelector<HTMLElement>('[data-output-kind="requested-edit:0"] .tool-output')!;
    const raw = card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    raw.open = true; button.focus(); button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.ok(output.classList.contains('edit-diff-wrapped'));
    assert.equal(card.querySelector('.edit-card-filename')?.textContent, 'a.ts');
    assert.equal(card.querySelector('.edit-card-directory')?.textContent, 'deep/folder/');
    updateToolCard(doc, card, { ...data, toolStatus: 'result', resultOutput: 'done' });
    assert.equal(card.querySelector('.edit-card-wrap'), button); assert.equal(doc.activeElement, button);
    assert.equal(card.querySelector('[data-output-kind="requested-edit:0"] .tool-output'), output);
    assert.ok(output.classList.contains('edit-diff-wrapped')); assert.equal(raw.open, true);
    assert.equal(card.querySelector('.card-plugin-body')?.nextElementSibling, raw);
    const result = card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    assert.equal(result.open, false); result.open = true;
    updateToolCard(doc, card, { ...data, toolStatus: 'result', resultOutput: 'latest' });
    assert.equal(card.querySelector('.tool-raw-output'), result); assert.equal(result.open, true);
    assert.equal(result.querySelector('.tool-output')?.textContent, 'latest');
    updateToolCard(doc, card, { ...data, arguments: {} });
    assert.equal(card.querySelector('.edit-card-wrap'), null); assert.equal(raw.open, true);
    assert.equal(raw.nextElementSibling, card.querySelector('.card-plugin-body'));
  } finally { dom.window.close(); }
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
    assert.doesNotMatch(historical.textContent || '', /Requested edit|not an applied-file diff/);
    assert.equal(historical.querySelector<HTMLDetailsElement>('.tool-raw-output')?.open, false);
    assert.equal(historical.querySelector('.card-plugin-body')?.nextElementSibling?.className, 'tool-raw-inputs');
    assert.match(historical.textContent || '', /Saved result/);
  } finally { dom.window.close(); }
});
