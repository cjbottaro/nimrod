import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { stubDialogs } from './dialog-fixture';
import { installCommandPalette } from '../src/command-palette';
import { installSettingsChoiceControls, settingsChoicePage, type ChooseSetting } from '../src/settings-choice-controls';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(choose?: ChooseSetting) {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const doc = dom.window.document;
  const get = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const parent = get<HTMLDialogElement>('settings-page'), dialog = get<HTMLDialogElement>('command-palette');
  const palette = installCommandPalette(dom.window as unknown as Window, dialog, {
    canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }), shortcuts: false,
  });
  for (const [id, value] of [['zoom-level', '125'], ['modal-animation-style', 'subtle'], ['send-auto-follow', 'whenIdle'], ['autocomplete-accept', 'tab']]) {
    const button = get<HTMLButtonElement>(id); button.value = value; button.disabled = false;
  }
  const writes: string[] = [], errors: unknown[] = [];
  const controls = installSettingsChoiceControls(doc, {
    choose: choose ?? settingsChoicePage(palette, parent),
    apply: { 'zoom-level': value => writes.push(value), 'modal-animation-style': value => writes.push(value),
      'send-auto-follow': value => writes.push(value), 'autocomplete-accept': value => writes.push(value) },
    error: (_id, error) => errors.push(error),
  });
  parent.showModal();
  return { dom, get, parent, dialog, controls, writes, errors, close() { controls.dispose(); palette.dispose(); dom.window.close(); } };
}

test('picker controls show plain values, accept after closing and restore their Settings opener', async () => {
  const f = fixture();
  try {
    assert.equal(f.get('autocomplete-accept-current').textContent, 'Tab only');
    assert.equal(f.get('modal-animation-style-current').textContent, 'Subtle');
    const button = f.get<HTMLButtonElement>('autocomplete-accept'); button.focus(); button.click();
    assert.equal(f.parent.open, true); assert.equal(f.dialog.open, true);
    assert.equal(f.writes.length, 0, 'opening is not a preference write');
    assert.equal(f.get('palette-list').querySelector('[data-key="tab"]')!.getAttribute('aria-current'), 'true');
    f.get('palette-list').querySelector<HTMLElement>('[data-key="tabOrEnter"]')!.click(); await tick();
    assert.equal(f.dialog.open, false); assert.equal(f.parent.open, true);
    assert.equal(f.dom.window.document.activeElement, button);
    assert.deepEqual(f.writes, ['tabOrEnter']);
    assert.equal(f.get('autocomplete-accept-current').textContent, 'Tab or Enter');
    assert.equal(button.value, 'tabOrEnter');
  } finally { f.close(); }
});

test('Escape and native cancel do not change settings or theme previews', async () => {
  const f = fixture();
  try {
    const button = f.get<HTMLButtonElement>('modal-animation-style'); button.focus(); button.click();
    f.get('palette-input').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();
    assert.equal(button.value, 'subtle'); assert.deepEqual(f.writes, []); assert.equal(f.parent.open, true);
    button.click(); f.dialog.dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true })); await tick();
    assert.equal(f.dialog.open, false); assert.deepEqual(f.writes, []);
    assert.equal(f.dom.window.document.activeElement, button);
    assert.equal(f.dialog.dataset.preview, undefined);
  } finally { f.close(); }
});

test('unrelated nested dialogs block Settings pickers and disposal suppresses late acceptance', async () => {
  const f = fixture();
  try {
    const nested = f.get<HTMLDialogElement>('host-dialog'); nested.showModal();
    f.get<HTMLButtonElement>('zoom-level').click(); await tick();
    assert.equal(f.dialog.open, false); assert.deepEqual(f.writes, []);
    nested.close();
  } finally { f.close(); }
  let finish!: (value: string) => void;
  const late = fixture(() => new Promise(resolve => { finish = resolve; }));
  try {
    late.get<HTMLButtonElement>('zoom-level').click(); late.controls.dispose();
    finish('150'); await tick();
    assert.deepEqual(late.writes, []); assert.deepEqual(late.errors, []);
    assert.equal(late.get<HTMLButtonElement>('zoom-level').value, '125');
  } finally { late.close(); }
});
