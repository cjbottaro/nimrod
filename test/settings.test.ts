import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installRuntimeSettings, installSettings, runtimePaths, type RuntimePaths } from '../src/settings';
import { stubDialogs } from './dialog-fixture';

function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const document = dom.window.document;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  get('welcome').hidden = false; // Simulate a completed normal-launch boot.
  const settings = installSettings(dom.window as unknown as Window, get('settings-page'), get('open-settings'), get('settings-back'));
  return { dom, document, get, settings, close: () => { settings.dispose(); dom.window.close(); } };
}

test('settings opens by gear/shortcut, remains idempotent, and native cancel returns to prior focus', () => {
  const f = fixture();
  try {
    const cwd = f.get<HTMLInputElement>('cwd'); cwd.focus();
    f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: ',', ctrlKey: true, cancelable: true }));
    assert.equal(f.settings.isOpen, true); assert.equal(f.document.activeElement, f.get('settings-back'));
    assert.equal(f.get('welcome').hidden, false); assert.equal(cwd.isConnected, true);
    const theme = f.get<HTMLSelectElement>('theme-picker'); theme.focus();
    f.settings.open(); assert.equal(f.document.activeElement, theme);
    f.get('settings-page').dispatchEvent(new f.dom.window.Event('cancel', { cancelable: true }));
    assert.equal(f.settings.isOpen, false); assert.equal(f.document.activeElement, cwd);
    f.get<HTMLButtonElement>('open-settings').click(); assert.equal(f.settings.isOpen, true);
    f.get<HTMLButtonElement>('settings-back').click(); assert.equal(f.settings.isOpen, false);
  } finally { f.close(); }
});

test('settings shortcuts respect IME, modifiers, consumed events and active extension dialogs', () => {
  const f = fixture();
  try {
    for (const extra of [{ altKey: true }, { isComposing: true }, { key: '.' }, { metaKey: false }]) {
      f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: ',', metaKey: true, ...extra, cancelable: true }));
      assert.equal(f.settings.isOpen, false);
    }
    const consumed = new f.dom.window.KeyboardEvent('keydown', { key: ',', metaKey: true, cancelable: true }); consumed.preventDefault();
    f.dom.window.dispatchEvent(consumed); assert.equal(f.settings.isOpen, false);
    const host = f.get<HTMLDialogElement>('host-dialog'); host.showModal();
    f.settings.open(); assert.equal(f.settings.isOpen, false);
    host.close(); f.settings.open(); host.showModal();
    f.settings.close(); assert.equal(f.settings.isOpen, true); // Never close beneath an active Pi dialog.
    host.close(); f.settings.close();
    f.settings.dispose(); f.get<HTMLButtonElement>('open-settings').click(); assert.equal(f.settings.isOpen, false);
  } finally { f.close(); }
});

function runtimeFixture(saved?: unknown, fail = false) {
  const f = fixture(); const saves: unknown[] = [];
  const runtime = installRuntimeSettings({ form: f.get('runtime-settings'), fields: f.get('runtime-fields'), pi: f.get('pi-path'), node: f.get('node-path'), status: f.get('runtime-status') }, {
    read: () => saved,
    save: paths => { if (fail) throw new Error('Storage quota exceeded'); saves.push(paths); },
  });
  const submit = () => f.get('runtime-settings').dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const edit = (paths: RuntimePaths) => {
    f.get<HTMLInputElement>('pi-path').value = paths.pi; f.get<HTMLInputElement>('node-path').value = paths.node;
    f.get('pi-path').dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  };
  return { ...f, runtime, saves, submit, edit, close: () => { runtime.dispose(); f.close(); } };
}

const defaults = { pi: '/detected/pi', node: '/detected/node' };

test('runtime fields wait for detection; legacy paths survive and new preferences take precedence', () => {
  const f = runtimeFixture();
  try {
    assert.equal(f.get<HTMLFieldSetElement>('runtime-fields').disabled, true);
    assert.throws(() => f.runtime.current(), /not ready/);
    f.submit(); assert.equal(f.saves.length, 0);
    f.runtime.initialize(defaults, { cwd: '/project', pi: '/legacy/pi' });
    assert.deepEqual(f.runtime.current(), { pi: '/legacy/pi', node: defaults.node });
    assert.equal(f.get<HTMLFieldSetElement>('runtime-fields').disabled, false);
    assert.equal(f.saves.length, 0);
  } finally { f.close(); }
  const next = runtimeFixture({ version: 1, pi: '/saved/pi', node: '/saved/node' });
  try {
    next.runtime.initialize(defaults, { pi: '/old/pi', node: '/old/node' });
    assert.deepEqual(next.runtime.current(), { pi: '/saved/pi', node: '/saved/node' });
  } finally { next.close(); }
});

test('runtime changes require Save, preserve unsaved drafts across navigation, and return launch snapshots', () => {
  const f = runtimeFixture();
  try {
    f.runtime.initialize(defaults); const running = f.runtime.current();
    f.settings.open(); f.edit({ pi: '  /new/pi  ', node: '/new/node' });
    assert.deepEqual(f.runtime.current(), defaults);
    assert.match(f.get('runtime-status').textContent!, /Unsaved/);
    f.settings.close(); f.settings.open(); assert.equal(f.get<HTMLInputElement>('pi-path').value, '  /new/pi  ');
    f.submit(); assert.equal(f.saves.length, 1);
    assert.deepEqual(f.runtime.current(), { pi: '/new/pi', node: '/new/node' });
    assert.deepEqual(running, defaults); assert.equal(f.get<HTMLInputElement>('pi-path').value, '/new/pi');
    assert.match(f.get('runtime-status').textContent!, /next session/);
  } finally { f.close(); }
});

test('invalid runtime values and persistence failure do not change committed paths', () => {
  for (const value of [{ pi: '', node: 'node' }, { pi: 'pi\n--bad', node: 'node' }, { pi: 'pi', node: 'x'.repeat(4097) }]) assert.throws(() => runtimePaths(value));
  const f = runtimeFixture();
  try {
    f.runtime.initialize(defaults); f.edit({ pi: '', node: 'node' }); f.submit();
    assert.deepEqual(f.runtime.current(), defaults); assert.equal(f.saves.length, 0);
    assert.match(f.get('runtime-status').textContent!, /Not saved/);
  } finally { f.close(); }
  const failing = runtimeFixture(undefined, true);
  try {
    failing.runtime.initialize(defaults); failing.edit({ pi: 'other-pi', node: 'node' }); failing.submit();
    assert.deepEqual(failing.runtime.current(), defaults);
    assert.match(failing.get('runtime-status').textContent!, /quota/);
  } finally { failing.close(); }
});

test('corrupt saved runtime preferences are recoverable without writing or changing focus', () => {
  const f = runtimeFixture({ version: 999, pi: 'pi', node: 'node' });
  try {
    f.settings.open(); const active = f.document.activeElement;
    f.runtime.initialize(defaults);
    assert.deepEqual(f.runtime.current(), defaults); assert.equal(f.saves.length, 0);
    assert.equal(f.document.activeElement, active); assert.match(f.get('runtime-status').textContent!, /Could not restore/);
  } finally { f.close(); }
});
