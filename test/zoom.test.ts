import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installZoom, savedZoom, zoomShortcut, ZOOM_STORAGE_KEY } from '../src/zoom';
import { webviewHtml } from './view-fixture';

function fixture(initial?: unknown, apply: (scale: number) => Promise<void> = async () => {}) {
  const dom = new JSDOM('<select id="zoom"></select><span id="notice" hidden></span><textarea></textarea>');
  const select = dom.window.document.querySelector('select')!;
  const notice = dom.window.document.querySelector('span')!;
  const scales: number[] = [], saved: number[] = [];
  const zoom = installZoom(dom.window as unknown as Window, select, notice, {
    read: () => initial, save: value => { saved.push(value); },
    apply: async scale => { scales.push(scale); await apply(scale); },
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const key = (key: string, ctrlKey = false) => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey, metaKey: !ctrlKey, cancelable: true }));
  return { dom, select, notice, zoom, scales, saved, tick, key, close: () => { zoom.dispose(); dom.window.close(); } };
}

test('saved zoom is validated; personal default is 125%, explicit 100% stays 100%', () => {
  for (const value of [undefined, null, '150', 0, -1, NaN, Infinity, 999, {}]) assert.equal(savedZoom(value), 125);
  for (const value of [75, 100, 125, 150, 200]) assert.equal(savedZoom(value), value);
});

test('whole-app zoom restores and persists only after native application', async () => {
  const f = fixture(150);
  try {
    await f.zoom.ready;
    assert.deepEqual(f.scales, [1.5]); assert.deepEqual(f.saved, []); // Restoration never rewrites configuration.
    assert.equal(f.select.value, '150'); assert.equal(f.select.disabled, false);
    f.select.value = '125'; f.select.dispatchEvent(new f.dom.window.Event('change'));
    await f.tick();
    assert.deepEqual(f.scales, [1.5, 1.25]); assert.equal(f.saved.at(-1), 125);
  } finally { f.close(); }
});

test('keyboard zoom serializes rapid changes, resets to 100%, and does not move focus', async () => {
  const f = fixture();
  try {
    await f.zoom.ready;
    const input = f.dom.window.document.querySelector('textarea')!;
    input.value = 'keep my draft'; input.focus();
    assert.equal(f.key('+'), false); f.key('='); f.key('-', true);
    await f.tick();
    assert.deepEqual(f.scales, [1.25, 1.5, 1.75, 1.5]);
    f.key('0'); await f.tick();
    assert.equal(f.select.value, '100');
    assert.equal(f.dom.window.document.activeElement, input); assert.equal(input.value, 'keep my draft');
    for (let i = 0; i < 20; i++) f.key('-');
    await f.tick(); assert.equal(f.select.value, '75');
  } finally { f.close(); }
});

test('failed zoom is not persisted or reported as applied; subsequent changes recover', async () => {
  const f = fixture(undefined, async scale => { if (scale === 1.5) throw new Error('native failure'); });
  try {
    await f.zoom.ready;
    f.key('+'); await f.tick();
    assert.equal(f.select.value, '125'); assert.deepEqual(f.saved, []);
    assert.equal(f.notice.hidden, false); assert.match(f.notice.textContent!, /native failure/);
    f.key('-'); await f.tick();
    assert.equal(f.select.value, '110'); assert.equal(f.notice.hidden, true);
    f.zoom.dispose(); f.key('+'); await f.tick();
    assert.equal(f.scales.at(-1), 1.1);
  } finally { f.close(); }
});

test('zoom shortcuts leave ordinary typing, IME and modified shortcuts alone', () => {
  const key = { key: '+', metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false };
  assert.equal(zoomShortcut(key), undefined);
  assert.equal(zoomShortcut({ ...key, ctrlKey: true }), 'in');
  for (const extra of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'v' }]) {
    assert.equal(zoomShortcut({ ...key, metaKey: true, ...extra }), undefined);
  }
});

test('conversation surfaces fill available width with a fixed gutter and full-width status border', () => {
  const dom = new JSDOM(webviewHtml());
  try {
    const activity = dom.window.document.querySelector<HTMLElement>('#activity')!;
    activity.hidden = false;
    for (const id of ['app', 'activity', 'submission-notice', 'composer']) {
      const node = dom.window.document.getElementById(id)!;
      node.hidden = false;
      const css = dom.window.getComputedStyle(node);
      assert.equal(css.width, '100%', id);
      assert.equal(css.maxWidth, 'none', id);
      assert.equal(css.boxSizing, 'border-box', id);
      assert.equal(css.paddingLeft, '20px', id);
      assert.equal(css.paddingRight, '20px', id);
      assert.equal(css.marginLeft, '0px', id);
      assert.equal(css.marginRight, '0px', id);
    }
    // jsdom does not resolve custom properties in border shorthands; inspect the actual rule.
    assert.match(readFileSync('src/pi/transcript.css', 'utf8'), /:is\(#activity, \[data-pi-id="activity"\]\) \{[^}]*border-bottom:1px solid var\(--interaction-edge\)/);
    assert.ok(JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8')).permissions.includes('core:webview:allow-set-webview-zoom'));
    assert.equal(ZOOM_STORAGE_KEY, 'nimrod.zoomPercent');
  } finally { dom.window.close(); }
});
