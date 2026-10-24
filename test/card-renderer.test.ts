import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CardRendererController, type CardRenderer } from '../src/pi/card-renderer';
import { renderToolCard, updateToolCard, disposeToolCard, type ToolCardBlock } from '../src/pi/tool-card';
import { rawToolPresentation } from '../src/pi/tool-presentation';

for (const phase of ['supports', 'mount', 'update', 'invalid'] as const) test(`renderer ${phase} failure is card-local and latches to current raw data`, () => {
  let disposed = 0; let mounted = 0;
  const errors: unknown[] = [];
  const renderer: CardRenderer<ToolCardBlock> = {
    id: 'fixture', supports: () => phase !== 'supports',
    mount() {
      mounted++;
      if (phase === 'mount') throw new Error('mount failed');
      return { update() {
        if (phase === 'update') throw new Error('update failed');
        return { title: 'bad', sections: [{ key: '', label: '', text: '' }] };
      }, dispose() { disposed++; throw new Error('dispose failed'); } };
    },
  };
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  try {
    const healthy = renderToolCard(doc, { name: 'bash', toolStatus: 'running', executionOutput: 'healthy' }, doc.createElement('details'));
    const spinner = healthy.querySelector('.tool-card-spinner');
    const card = renderToolCard(doc, { name: 'custom', toolStatus: 'running', executionOutput: 'first' }, doc.createElement('details'), renderer, error => errors.push(error));
    doc.body.append(healthy, card); card.open = true;
    updateToolCard(doc, card, { name: 'custom', arguments: { input: 'retained' }, toolStatus: 'result', resultOutput: 'latest' });
    assert.equal(card.querySelector('.tool-output')?.textContent, 'latest');
    assert.match(card.querySelector('.tool-raw-inputs pre')?.textContent || '', /retained/);
    assert.equal(card.open, true);
    assert.equal(healthy.querySelector('.tool-card-spinner'), spinner);
    assert.equal(spinner?.isConnected, true);
    disposeToolCard(card); disposeToolCard(card);
    assert.equal(mounted, phase === 'supports' ? 0 : 1);
    assert.equal(disposed, phase === 'mount' || phase === 'supports' ? 0 : 1);
    assert.ok(errors.length);
  } finally { dom.window.close(); }
});

test('renderer lifetime mounts once, updates incrementally and disposes exactly once', () => {
  let mounts = 0; let updates = 0; let disposals = 0;
  const owner = new CardRendererController<ToolCardBlock>({ id: 'fixture', supports: () => true,
    mount() { mounts++; return { update(data) { updates++; return rawToolPresentation(data); }, dispose() { disposals++; } }; },
  }, rawToolPresentation);
  owner.update({ executionOutput: 'one' }); owner.update({ resultOutput: 'two' });
  owner.dispose(); owner.dispose();
  assert.deepEqual([mounts, updates, disposals], [1, 2, 1]);
  assert.throws(() => owner.update({}), /disposed/);
});
