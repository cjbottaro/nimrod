import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DomCardController, type DomCardRenderer, type CardPluginContext } from '../src/pi/dom-card-renderer';
import { renderToolCard, updateToolCard, disposeToolCard, type ToolCardBlock } from '../src/pi/tool-card';
import { bundledToolRenderer } from '../src/pi/card-plugins/registry';
import { reasoningDomRenderer } from '../src/pi/card-plugins/reasoning';
import { parallelDomRenderer } from '../src/pi/card-plugins/parallel';

for (const phase of ['mount', 'update', 'event', 'async-event'] as const) test(`DOM plugin ${phase} failure preserves shell/sibling/raw data and releases managed handlers`, async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document;
  let disposed = 0; let calls = 0; let context!: CardPluginContext;
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.dom', supports: () => true,
    mount(ctx) {
      context = ctx;
      const button = doc.createElement('button'); button.textContent = 'Custom'; ctx.body.append(button);
      ctx.on(button, 'click', () => { calls++; if (phase === 'async-event') return Promise.reject(new Error('async')); throw new Error('event'); });
      if (phase === 'mount') throw new Error('mount');
      return { update(data) { if (phase === 'update') throw new Error('update'); ctx.summary.textContent = String(data.name); }, dispose() { disposed++; } };
    },
  };
  try {
    const healthy = renderToolCard(doc, { name: 'read', toolStatus: 'running' }, doc.createElement('details')); doc.body.append(healthy);
    const spinner = healthy.querySelector('.tool-card-spinner');
    const data = { name: 'fixture', toolStatus: 'result' as const, resultOutput: 'retained raw' };
    const card = renderToolCard(doc, data, doc.createElement('details'), plugin); doc.body.append(card); card.open = true;
    const button = card.querySelector('button');
    button?.click(); await Promise.resolve(); await Promise.resolve();
    assert.match(card.textContent || '', /retained raw/);
    assert.equal(card.open, true); assert.equal(healthy.querySelector('.tool-card-spinner'), spinner);
    assert.equal(spinner?.isConnected, true); assert.equal(context.signal.aborted, true);
    button?.click(); assert.equal(calls, button ? 1 : 0);
    updateToolCard(doc, card, { ...data, resultOutput: 'latest raw' }); assert.match(card.textContent || '', /latest raw/);
    disposeToolCard(card); disposeToolCard(card);
    assert.equal(disposed, phase === 'mount' ? 0 : 1);
  } finally { dom.window.close(); }
});

test('async lifecycle updates are rejected with raw recovery and no unhandled rejection', async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; const errors: unknown[] = [];
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.async', supports: () => true,
    mount: () => ({ update: async () => { throw new Error('async update'); }, dispose() {} }),
  };
  const card = renderToolCard(doc, { name: 'async', resultOutput: 'raw' }, doc.createElement('details'), plugin, error => errors.push(error));
  await Promise.resolve(); await Promise.resolve();
  assert.match(card.textContent || '', /raw/); assert.equal(errors.length, 2); dom.window.close();
});

test('reentrant managed mount failure disposes the returned instance without updating it', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; let updates = 0; let disposals = 0;
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.reentrant', supports: () => true,
    mount(ctx) {
      ctx.mutate(() => { throw new Error('mount mutation failed'); });
      return { update() { updates++; }, dispose() { disposals++; } };
    },
  };
  const card = renderToolCard(doc, { name: 'fixture', resultOutput: 'raw' }, doc.createElement('details'), plugin);
  assert.match(card.textContent || '', /raw/); assert.deepEqual([updates, disposals], [0, 1]); dom.window.close();
});

test('custom DOM retains local input/focus across updates and independent registered output inspection', () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; let field!: HTMLInputElement;
  const outputs: HTMLElement[] = [];
  const plugin: DomCardRenderer<ToolCardBlock> = { apiVersion: 2, id: 'fixture.custom', supports: () => true,
    mount(ctx) {
      field = doc.createElement('input'); ctx.body.append(field);
      for (const key of ['a', 'b']) { const output = doc.createElement('pre'); ctx.body.append(output); ctx.registerOutput(key, output); outputs.push(output); }
      return { update(data) { for (const output of outputs) output.textContent = data.executionOutput || ''; }, dispose() {} };
    },
  };
  try {
    const data = { name: 'custom', toolStatus: 'running' as const, executionOutput: 'one' };
    const card = renderToolCard(doc, data, doc.createElement('details'), plugin); doc.body.append(card);
    field.value = 'local'; field.focus();
    outputs.forEach((output, i) => { Object.defineProperties(output, { clientHeight: { value: 100 }, scrollHeight: { value: 600 } }); output.scrollTop = 20 + i * 70; });
    updateToolCard(doc, card, { ...data, executionOutput: 'two' });
    assert.equal(doc.activeElement, field); assert.equal(field.value, 'local');
    assert.deepEqual(outputs.map(output => output.scrollTop), [20, 90]);
    assert.ok(outputs.every(output => output.classList.contains('tool-output-streaming')));
    assert.equal(card.querySelector<HTMLDetailsElement>('.tool-raw-output')?.hidden, false);
    assert.match(card.querySelector('.tool-raw-output')?.textContent || '', /two/);
    updateToolCard(doc, card, { ...data, toolStatus: 'result', resultOutput: 'done' });
    assert.deepEqual(outputs.map(output => output.scrollTop), [20, 90]);
    assert.ok(outputs.every(output => output.classList.contains('tool-output-final')));
  } finally { dom.window.close(); }
});

test('managed mutation captures before change and becomes inert after disposal; bundled inventory implements DOM API', () => {
  const dom = new JSDOM('<body><span id="summary"></span><div id="body"></div></body>'); const doc = dom.window.document;
  const order: string[] = []; let context!: CardPluginContext;
  const owner = new DomCardController<string>({ apiVersion: 2, id: 'fixture', supports: () => true,
    mount(ctx) { context = ctx; return { update() {}, dispose() {} }; },
  }, doc.querySelector('#summary')!, doc.querySelector('#body')!, text => ({ title: 'Raw', sections: [{ key: 'raw', label: 'Raw', text }] }),
  { beforeChange: () => order.push('before'), afterChange: () => order.push('after') });
  owner.update('data', { streaming: false }); context.mutate(() => order.push('mutation'));
  assert.deepEqual(order, ['before', 'mutation', 'after']);
  owner.dispose(); context.mutate(() => assert.fail('disposed mutation')); assert.equal(context.signal.aborted, true);
  for (const renderer of [bundledToolRenderer({ name: 'read' }), bundledToolRenderer({ name: 'edit' }), reasoningDomRenderer, parallelDomRenderer]) assert.equal(renderer.apiVersion, 2);
  dom.window.close();
});
