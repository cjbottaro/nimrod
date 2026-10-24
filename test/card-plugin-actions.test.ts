import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DomCardController, type CardPluginContext } from '../src/pi/dom-card-renderer';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';

test('presentation capabilities accept safe historical actions, reject invalid links/hidden/modal/disposed work, and expose no execution API', async () => {
  const dom = new JSDOM('<body><span id="summary"></span><div id="body"></div></body>'); const doc = dom.window.document;
  let active = true; let ctx!: CardPluginContext; const calls: string[] = [];
  const owner = new DomCardController<string>({ apiVersion: 2, id: 'fixture', supports: () => true,
    mount(context) { ctx = context; return { update() {}, dispose() {} }; },
  }, doc.querySelector('#summary')!, doc.querySelector('#body')!, text => ({ title: 'Raw', sections: [{ key: 'raw', label: 'Raw', text }] }), {
    copy: async text => { calls.push(`copy:${text}`); }, openLink: async href => { calls.push(`link:${href}`); },
    popOutCode: async (text, language) => { calls.push(`popout:${language}:${text}`); }, canInteract: () => active,
  });
  try {
    owner.update('saved data', { streaming: false });
    assert.deepEqual(ctx.capabilities, { copy: true, openLink: true, popOutCode: true });
    await ctx.copy('historical'); await ctx.openLink('README.md:1'); await ctx.popOutCode('diff', 'diff');
    await assert.rejects(ctx.openLink('javascript:alert(1)'), /Unsupported/);
    await assert.rejects(ctx.openLink('command:execute'), /Unsupported/);
    await assert.rejects(ctx.copy('a'.repeat(8 * 1024 * 1024 + 1)), /oversized/);
    active = false; await assert.rejects(ctx.copy('hidden'), /unavailable/);
    owner.dispose(); await assert.rejects(ctx.copy('disposed'), /unavailable/);
    assert.deepEqual(calls, ['copy:historical', 'link:README.md:1', 'popout:diff:diff']);
    assert.equal('postMessage' in ctx, false); assert.equal('prompt' in ctx, false);
  } finally { dom.window.close(); }
});

test('requested edit copy uses latest structured inputs, preserves controls/focus and ignores stale detached handlers', async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; const copied: string[] = [];
  const data = { name: 'edit', arguments: { path: 'a', oldText: 'old', newText: 'new' }, toolStatus: 'result' as const, resultOutput: 'saved' };
  const card = renderToolCard(doc, data, doc.createElement('details'), undefined, undefined, { copy: async text => { copied.push(text); } }); doc.body.append(card); card.open = true;
  try {
    const button = card.querySelector<HTMLButtonElement>('.card-plugin-copy')!; button.focus(); button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(copied, ['-old\n+new']); assert.equal(doc.activeElement, button); assert.equal(card.open, true);
    assert.equal(card.querySelector('.card-plugin-copy-status')?.textContent, 'Copied');
    updateToolCard(doc, card, { ...data, arguments: { path: 'a', oldText: 'old', newText: 'latest' } });
    assert.equal(card.querySelector('.card-plugin-copy'), button); button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(copied.at(-1), '-old\n+latest');
    updateToolCard(doc, card, { ...data, arguments: {} }); button.click();
    assert.equal(copied.length, 2); disposeToolCard(card);
  } finally { dom.window.close(); }
});

test('late copy completion after disposal does not mutate the detached plugin UI', async () => {
  const dom = new JSDOM('<body></body>'); const doc = dom.window.document; let resolve!: () => void;
  const card = renderToolCard(doc, { name: 'edit', arguments: { oldText: 'a', newText: 'b' } }, doc.createElement('details'), undefined, undefined,
    { copy: () => new Promise<void>(done => { resolve = done; }) }); doc.body.append(card);
  card.querySelector<HTMLButtonElement>('.card-plugin-copy')!.click();
  assert.equal(typeof resolve, 'function', 'copy must start before disposal');
  disposeToolCard(card); resolve();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(card.querySelector('.card-plugin-copy-status')?.textContent, ''); dom.window.close();
});
