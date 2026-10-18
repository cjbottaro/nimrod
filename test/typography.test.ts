import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyTypography, DEFAULT_TYPOGRAPHY, fontStack, readTypography, TYPOGRAPHY_KEYS } from '../src/typography';
import { installTypography } from '../src/typography-controls';
import { installFontPicker } from '../src/font-picker';
import { applyModalAnimation } from '../src/modal-animation';
import { installModalMotion } from '../src/modal-motion';
import { stubDialogs } from './dialog-fixture';

test('typography defaults, exact bounds, single-family quoting and changed-only presentation', () => {
  assert.deepEqual(readTypography({}), DEFAULT_TYPOGRAPHY);
  for (const key of ['appearance.conversationFontSize', 'appearance.monospaceFontSize']) {
    for (const value of [10, 14, 32]) assert.equal(readTypography({ [key]: value })[key.includes('conversation') ? 'conversationSize' : 'monospaceSize'], value);
    for (const value of [null, true, '', '14', 9, 33, 14.5]) assert.throws(() => readTypography({ [key]: value }));
  }
  for (const key of ['appearance.conversationFont', 'appearance.monospaceFont']) {
    for (const value of [null, true, [], ' padded', 'padded ', ' \t', 'A\nB', 'A\u0085B', 'A'.repeat(201)]) assert.throws(() => readTypography({ [key]: value }));
    for (const value of ['', 'Font With Spaces', '字'.repeat(200), '🦊'.repeat(200)]) assert.doesNotThrow(() => readTypography({ [key]: value }));
  }
  assert.equal(fontStack('Font", serif; color:red; /*'), '"Font\\", serif; color:red; /*", -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif');
  const dom = new JSDOM('<textarea>Unchanged draft</textarea>');
  try {
    const root = dom.window.document.documentElement, events: string[] = [];
    dom.window.document.addEventListener('nimrod-typography-will-change', () => events.push('before'));
    dom.window.document.addEventListener('nimrod-typography-changed', () => events.push('after'));
    root.style.setProperty('--vscode-font-family', 'Interface Font');
    applyTypography(root, { ...DEFAULT_TYPOGRAPHY, conversationFont: 'Readable', monospaceSize: 18 });
    applyTypography(root, { ...DEFAULT_TYPOGRAPHY, conversationFont: 'Readable', monospaceSize: 18 });
    assert.deepEqual(events, ['before', 'after']);
    assert.match(root.style.getPropertyValue('--nimrod-conversation-font'), /^"Readable",/);
    assert.equal(root.style.getPropertyValue('--nimrod-monospace-size'), '18px');
    assert.equal(root.style.getPropertyValue('--vscode-font-family'), 'Interface Font');
    assert.equal(dom.window.document.querySelector('textarea')!.value, 'Unchanged draft');
  } finally { dom.window.close(); }
});

function controlsFixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const doc = dom.window.document;
  stubDialogs(dom.window);
  applyModalAnimation(doc.documentElement, { style: 'none', duration: 500 });
  const motion = installModalMotion(doc);
  let value = { ...DEFAULT_TYPOGRAPHY };
  const writes: Partial<typeof value>[] = [], failures: [string, string | undefined][] = [];
  const pending: { values: Partial<typeof value>; resolve(): void; reject(error: Error): void }[] = [];
  const controls = installTypography(doc.documentElement, {
    read: () => ({ ...value }),
    save: values => {
      writes.push(values);
      return new Promise<void>((resolve, reject) => pending.push({ values, resolve: () => { Object.assign(value, values); controls.reload(); resolve(); }, reject }));
    },
    reset: async () => { value = { ...DEFAULT_TYPOGRAPHY }; },
    fonts: async () => [{ family: 'Fixture Mono', monospace: true }, { family: 'Fixture Sans', monospace: false }],
    report: (cause, message) => failures.push([cause, message]),
  }, true);
  const input = doc.getElementById('conversation-font-size') as HTMLInputElement;
  return { dom, doc, controls, input, writes, pending, failures,
    external(next: Partial<typeof value>) { Object.assign(value, next); controls.reload(); },
    dispose() { controls.dispose(); motion.dispose(); dom.window.close(); },
  };
}
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };

test('typography controls preview locally before persistence, keep newer edits and roll back failed saves', async () => {
  const f = controlsFixture();
  try {
    f.input.value = '18'; f.input.dispatchEvent(new f.dom.window.Event('input'));
    assert.equal(f.doc.documentElement.style.getPropertyValue('--nimrod-conversation-size'), '18px');
    assert.equal(f.writes.length, 0, 'typing is not a settings write');
    f.input.dispatchEvent(new f.dom.window.Event('change'));
    assert.deepEqual([...f.writes], [{ conversationSize: 18 }]);
    f.doc.getElementById('conversation-font-larger')!.click();
    assert.equal(f.input.value, '19');
    f.pending[0].resolve(); await settle();
    assert.equal(f.input.value, '19', 'old completion cannot replace newer intent');
    f.pending[1].reject(new Error('Settings changed on disk')); await settle();
    assert.equal(f.input.value, '18');
    assert.match(f.failures.find(([, message]) => message)?.[1] ?? '', /Settings changed on disk/);
    f.external({ monospaceSize: 22 });
    assert.equal((f.doc.getElementById('monospace-font-size') as HTMLInputElement).value, '22');
    f.doc.getElementById('typography-reset')!.click(); await settle();
    assert.equal(f.input.value, '14');
    assert.equal(f.doc.documentElement.style.getPropertyValue('--nimrod-monospace-size'), '14px');
    f.input.value = '99'; f.input.dispatchEvent(new f.dom.window.Event('change'));
    assert.equal(f.input.value, '14');
    assert.match(f.failures.at(-1)?.[1] ?? '', /10 to 32/);
    assert.equal(f.writes.length, 2);
  } finally { f.dispose(); }
});

test('font picker filters samples, prioritizes monospace, preserves parent and restores opener focus', async () => {
  const f = controlsFixture();
  try {
    const parent = f.doc.getElementById('settings-page') as HTMLDialogElement;
    parent.showModal();
    const opener = f.doc.getElementById('monospace-font') as HTMLButtonElement;
    opener.focus(); opener.click(); await settle();
    const picker = f.doc.getElementById('font-picker') as HTMLDialogElement;
    assert.equal(parent.open, true); assert.equal(picker.open, true);
    const rows = [...picker.querySelectorAll('[role=option]')];
    assert.deepEqual(rows.map(row => row.querySelector('span')!.textContent), ['System default', 'Fixture Mono', 'Fixture Sans']);
    assert.match((rows[1].querySelector('span') as HTMLElement).style.fontFamily, /Fixture Mono/);
    const search = picker.querySelector('input')!;
    search.value = 'sans'; search.dispatchEvent(new f.dom.window.Event('input'));
    assert.equal(picker.querySelectorAll('[role=option]').length, 1);
    search.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(picker.open, false); assert.equal(parent.open, true);
    assert.equal(f.doc.activeElement, opener);
    assert.equal(opener.textContent, 'Fixture Sans ▾');
    assert.deepEqual([...f.writes], [{ monospaceFont: 'Fixture Sans' }]);
    f.pending[0].resolve(); await settle();
    opener.click();
    const cancel = new f.dom.window.Event('cancel', { cancelable: true }); picker.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true); assert.equal(picker.open, false);
    assert.equal(f.writes.length, 1, 'Escape/native cancel does not edit preferences');
  } finally { f.dispose(); }
});

test('closed font requests cannot apply late results; failures retain an explicit fallback and Refresh', async () => {
  const dom = new JSDOM('<button id="open">Open</button>', { pretendToBeVisual: true });
  stubDialogs(dom.window); applyModalAnimation(dom.window.document.documentElement, { style: 'none', duration: 500 });
  const motion = installModalMotion(dom.window.document), errors: (string | undefined)[] = [], chosen: string[] = [];
  let reject!: (error: Error) => void;
  const picker = installFontPicker(dom.window.document, { fonts: () => new Promise((_, fail) => { reject = fail; }), report: error => errors.push(error) });
  try {
    const opener = dom.window.document.getElementById('open')!;
    const open = () => picker.open({ current: 'Missing Font', monospace: false, opener, select: font => chosen.push(font) });
    open(); reject(new Error('Catalog unavailable')); await settle();
    assert.match(errors.at(-1) ?? '', /Catalog unavailable/);
    assert.match(dom.window.document.querySelector('#font-picker-list')!.textContent ?? '', /System default.*Missing Font.*Saved font/);
    assert.equal((dom.window.document.querySelector('[data-refresh]') as HTMLButtonElement).disabled, false);
    dom.window.document.querySelector<HTMLButtonElement>('[data-close]')!.click();
    open(); dom.window.document.querySelector<HTMLButtonElement>('[data-close]')!.click();
    const count = errors.length;
    reject(new Error('Late failure')); await settle();
    assert.equal(errors.length, count); assert.deepEqual(chosen, []);
  } finally { picker.dispose(); motion.dispose(); dom.window.close(); }
});

test('typography key inventory stays explicit and global-only', () => {
  assert.deepEqual(Object.values(TYPOGRAPHY_KEYS), [
    'appearance.conversationFont', 'appearance.conversationFontSize', 'appearance.monospaceFont', 'appearance.monospaceFontSize',
  ]);
});
