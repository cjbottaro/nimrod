import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ACTIONS, bindingsFor, changeBinding, installKeybindingDispatch, matchesBinding, readKeyOverrides, recordBinding, shortcutLabel, validateBinding, type ActionId, type KeyOverrides } from '../src/keybindings';
import { installKeybindingEditor } from '../src/keybinding-editor';
import { editSettings, installPreferences, parseSettings } from '../src/preferences';
import { MemoryPreferences } from './preferences-fixture';
import { stubDialogs } from './dialog-fixture';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const dom = new JSDOM('<button id="origin">Settings</button><dialog id="settings-page"><div class="settings-content"></div></dialog><dialog id="pi-dialog"></dialog>', { pretendToBeVisual: true });
  Object.defineProperty(dom.window.navigator, 'platform', { value: 'MacIntel' });
  stubDialogs(dom.window);
  const win = dom.window as unknown as Window, doc = dom.window.document;
  const get = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const event = (key: string, extra: KeyboardEventInit = {}) => new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  return { dom, win, doc, get, event };
}

test('defaults distinguish creation, named creation, open-session switching and saved-history search', () => {
  for (const [id, binding] of [['new', 'primary+n'], ['temporary', 'primary+shift+n'], ['delete', 'primary+backspace'], ['model', 'primary+m'], ['thinking', 'primary+e']] as const) assert.ok(bindingsFor(id, {}).includes(binding));
  assert.deepEqual(bindingsFor('new', {}), ['primary+n']);
  assert.deepEqual(bindingsFor('new-named', {}), ['primary+alt+n']);
  assert.deepEqual(bindingsFor('switch-session', {}), ['primary+t']);
  assert.equal(ACTIONS.some(action => action.defaults.some(binding => String(binding) === 'primary+p')), false);
  assert.deepEqual(bindingsFor('resume', {}), ['primary+k']);
  assert.deepEqual(bindingsFor('new', { new: ['primary+t'] }), ['primary+t'], 'explicit overrides are not migrated');
  for (const action of ACTIONS) assert.deepEqual(changeBinding({}, action.id, undefined, false, true), { [action.id]: undefined }, 'defaults are conflict-free');
  assert.deepEqual(bindingsFor('new', { new: [] }), []);
  assert.deepEqual(bindingsFor('new', { new: ['primary+j'] }), ['primary+j']);
  assert.deepEqual(changeBinding({ new: [] }, 'new', undefined, false, true), { new: undefined });
  for (const action of ACTIONS) for (const binding of action.defaults) assert.equal(validateBinding(binding), binding);
  assert.deepEqual(readKeyOverrides({ 'future-action': ['primary+j'] }), { 'future-action': ['primary+j'] });
  for (const value of [null, [], { new: 'primary+n' }, { new: ['primary+n', 'primary+n'] }, { new: ['n'] }, { new: ['primary+v'] }, { new: ['primary+='] }, { new: ['primary+shift+plus'] }, { new: ['primary+cmd+n'] }, { new: ['primary+\u0000'] }]) assert.throws(() => readKeyOverrides(value));
});

test('recording and matching normalize platform modifiers, Shift and zoom punctuation', () => {
  const f = fixture();
  try {
    assert.equal(recordBinding(f.event('N', { metaKey: true, shiftKey: true }), true), 'primary+shift+n');
    assert.equal(recordBinding(f.event('e', { ctrlKey: true }), false), 'primary+e');
    assert.equal(recordBinding(f.event('+', { metaKey: true, shiftKey: true }), true), 'primary+plus');
    assert.equal(recordBinding(f.event('Meta', { metaKey: true }), true), undefined);
    assert.equal(recordBinding(f.event('n', { metaKey: true, isComposing: true }), true), undefined);
    assert.equal(recordBinding(f.event('Dead', { altKey: true, metaKey: true }), true), undefined);
  } finally { f.dom.window.close(); }
});

test('macOS Command-Option shortcuts normalize Option dead keys consistently for dispatch and recording', () => {
  const f = fixture(), ran: ActionId[] = [];
  const dispatch = installKeybindingDispatch(f.win, { read: () => ({}), enabled: () => true, run: id => { ran.push(id); }, error: error => { throw error; } });
  try {
    for (const key of ['Dead', '˜', 'ñ']) {
      const event = f.event(key, { code: 'KeyN', metaKey: true, altKey: true });
      assert.equal(matchesBinding(event, 'primary+alt+n', true), true, key);
      assert.equal(recordBinding(event, true), 'primary+alt+n', key);
      assert.equal(matchesBinding(event, 'primary+n', true), false, 'Option remains a required modifier');
      f.win.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
    }
    assert.deepEqual(ran, ['new-named', 'new-named', 'new-named']);
    const typing = f.event('Dead', { code: 'KeyN', altKey: true }); f.win.dispatchEvent(typing);
    assert.equal(typing.defaultPrevented, false); assert.equal(recordBinding(typing, true), undefined);
    assert.equal(matchesBinding(f.event('Dead', { code: 'KeyN', ctrlKey: true, altKey: true }), 'primary+alt+n', false), false);
    assert.equal(matchesBinding(f.event('z', { code: 'KeyY', metaKey: true, altKey: true }), 'primary+alt+z', true), true, 'already-readable layout characters stay layout-aware');
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      const event = f.event('Dead', { code: 'KeyN', metaKey: true, altKey: true, ...extra });
      assert.equal(recordBinding(event, true), undefined); f.win.dispatchEvent(event);
    }
    assert.equal(ran.length, 3);
    assert.equal(recordBinding(f.event('Dead', { code: 'Unidentified', metaKey: true, altKey: true }), true), undefined);
  } finally { dispatch.dispose(); f.dom.window.close(); }
});

test('key matching distinguishes modifiers and handles bracket switching across shifted layouts', () => {
  const f = fixture();
  try {
    assert.equal(matchesBinding(f.event('n', { metaKey: true }), 'primary+n', true), true);
    assert.equal(matchesBinding(f.event('n', { ctrlKey: true }), 'primary+n', true), false);
    assert.equal(matchesBinding(f.event('n', { ctrlKey: true }), 'primary+n', false), true);
    assert.equal(matchesBinding(f.event('n', { metaKey: true, ctrlKey: true }), 'primary+n'), false);
    assert.equal(matchesBinding(f.event('n', { metaKey: true, shiftKey: true }), 'primary+n'), false);
    assert.equal(matchesBinding(f.event('{', { code: 'BracketLeft', metaKey: true, shiftKey: true }), 'primary+shift+['), true);
    assert.equal(matchesBinding(f.event('=', { metaKey: true }), 'primary+plus'), true);
    assert.equal(shortcutLabel('primary+shift+n', true), '⌘+⇧+N');
    assert.equal(shortcutLabel('primary+shift+n', false), 'Ctrl+Shift+N');
  } finally { f.dom.window.close(); }
});

test('dispatch intercepts before text editing, consumes repeats/unavailable actions and respects modal priority and IME', () => {
  const f = fixture(), ran: ActionId[] = [], errors: unknown[] = [];
  let overrides: KeyOverrides = {}, enabled = true;
  const dispatch = installKeybindingDispatch(f.win, { read: () => overrides, enabled: () => enabled, run: id => { ran.push(id); }, error: error => errors.push(error) });
  try {
    const input = f.doc.createElement('textarea'); f.doc.body.append(input);
    let edited = false; input.addEventListener('keydown', () => { edited = true; });
    input.dispatchEvent(f.event('Backspace', { metaKey: true })); assert.equal(edited, false); assert.deepEqual(ran, ['delete']);
    for (const extra of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) input.dispatchEvent(f.event('n', { metaKey: true, ...extra }));
    assert.equal(ran.length, 1);
    const prevented = f.event('n', { metaKey: true }); prevented.preventDefault(); input.dispatchEvent(prevented); assert.equal(ran.length, 1);
    enabled = false; const unavailable = f.event('Backspace', { metaKey: true }); input.dispatchEvent(unavailable); assert.equal(unavailable.defaultPrevented, true); assert.equal(ran.length, 1); enabled = true;
    f.get<HTMLDialogElement>('settings-page').showModal();
    input.dispatchEvent(f.event('n', { metaKey: true })); assert.equal(ran.length, 1);
    f.win.dispatchEvent(f.event('+', { metaKey: true })); assert.equal(ran.at(-1), 'zoom-in');
    f.get<HTMLDialogElement>('pi-dialog').showModal(); f.win.dispatchEvent(f.event('+', { metaKey: true })); assert.equal(ran.length, 2);
    f.get<HTMLDialogElement>('pi-dialog').close(); f.get<HTMLDialogElement>('settings-page').close();
    overrides = { new: [], temporary: ['primary+n'] };
    input.dispatchEvent(f.event('n', { metaKey: true })); assert.equal(ran.at(-1), 'temporary');
    overrides = { temporary: ['primary+n'] }; input.dispatchEvent(f.event('n', { metaKey: true })); assert.equal(errors.length, 1); assert.equal(ran.length, 3);
    dispatch.dispose(); input.dispatchEvent(f.event('m', { metaKey: true })); assert.equal(ran.length, 3);
  } finally { dispatch.dispose(); f.dom.window.close(); }
});

test('reassignment and individual reset report conflicts, including explicit platform aliases', () => {
  assert.throws(() => changeBinding({}, 'model', ['cmd+n'], false, true), /New session/);
  assert.deepEqual(changeBinding({}, 'model', ['cmd+n'], true, true), { model: ['cmd+n'], new: [] });
  assert.throws(() => changeBinding({ new: ['primary+j'], model: ['primary+n'] }, 'new', undefined, false, true), /Select model/);
  assert.deepEqual(changeBinding({ new: ['primary+j'], model: ['primary+n'] }, 'new', undefined, true, true), { new: undefined, model: [] });
});

test('preferences save per-action JSONC patches against fresh snapshots, retain unknown IDs and reset without touching unrelated settings', async () => {
  const dom = new JSDOM('', { url: 'http://fixture' }), host = new MemoryPreferences();
  host.value.text = '{ // preserve\n "keybindings": {"model":[], "future-action":["primary+j"]}, "future": true }'; host.value.state.legacyMigrated = true;
  const p = await installPreferences(host, dom.window.localStorage, () => {});
  try {
    await p.saveKeybinding('new', ['primary+l'], false, true);
    assert.match(host.value.text, /preserve/); assert.equal(parseSettings(host.value.text).future, true);
    assert.deepEqual(p.keybindings()['future-action'], ['primary+j']);
    // This change happens on disk without delivering a broadcast first.
    host.value.text = editSettings(host.value.text, { keybindings: { ...p.keybindings(), model: ['primary+u'] } }); host.value.revision++;
    await p.saveKeybinding('thinking', ['primary+r'], false, true);
    assert.deepEqual(p.keybindings().model, ['primary+u']);
    await p.saveKeybinding('new', undefined, false, true); assert.equal(p.keybindings().new, undefined);
    await p.saveKeybinding('model', ['primary+n'], true, true); assert.deepEqual(p.keybindings().new, []);
    await p.resetKeybindings(); assert.deepEqual(p.keybindings(), {}); assert.equal(parseSettings(host.value.text).future, true); assert.match(host.value.text, /preserve/);
  } finally { p.dispose(); dom.window.close(); }
});

test('new conflicts discovered at save time cannot silently steal unreviewed bindings', async () => {
  const dom = new JSDOM('', { url: 'http://fixture' }), host = new MemoryPreferences(); host.value.state.legacyMigrated = true;
  const p = await installPreferences(host, dom.window.localStorage, () => {});
  try {
    host.value.text = '{"keybindings":{"thinking":["primary+n"]}}'; host.value.revision++;
    await assert.rejects(p.saveKeybinding('model', ['primary+n'], true, true), /conflicts changed/);
    assert.equal(p.keybindings().model, undefined); assert.deepEqual(p.keybindings().thinking, ['primary+n']);
    host.external('{"keybindings":{"new":"broken"}}');
    assert.deepEqual(p.keybindings().thinking, ['primary+n']);
    await assert.rejects(p.resetKeybindings(), /keybindings|array/);
  } finally { p.dispose(); dom.window.close(); }
});

test('saving cannot overwrite a target action changed on disk before the latest snapshot', async () => {
  const dom = new JSDOM('', { url: 'http://fixture' }), host = new MemoryPreferences(); host.value.state.legacyMigrated = true;
  const p = await installPreferences(host, dom.window.localStorage, () => {});
  try {
    host.value.text = '{"keybindings":{"model":["primary+u"]}}'; host.value.revision++;
    await assert.rejects(p.saveKeybinding('model', ['primary+j'], false, true), /This action changed/);
    assert.deepEqual(p.keybindings().model, ['primary+u']);
  } finally { p.dispose(); dom.window.close(); }
});

test('editor preserves unrelated-update focus and invalidates stale target/conflict approval', () => {
  const f = fixture(); let overrides: KeyOverrides = {};
  const editor = installKeybindingEditor(f.win, f.get('settings-page').querySelector<HTMLElement>('.settings-content')!, {
    read: () => overrides, save: async () => {}, resetAll: async () => {},
  });
  try {
    f.get<HTMLDialogElement>('settings-page').showModal();
    const change = f.doc.querySelector<HTMLButtonElement>('.keybinding-row[data-action="model"] button')!;
    change.focus(); editor.reload(); assert.equal(f.doc.activeElement, change); assert.equal(change.isConnected, true);
    change.click(); f.get('keybinding-record').dispatchEvent(f.event('n', { metaKey: true }));
    const reassign = f.get<HTMLInputElement>('keybinding-reassign'); reassign.checked = true; reassign.dispatchEvent(new f.dom.window.Event('change'));
    assert.equal(f.get<HTMLButtonElement>('keybinding-save').disabled, false);
    overrides = { temporary: ['primary+n'] }; editor.reload(); assert.equal(reassign.checked, false); assert.equal(f.get<HTMLButtonElement>('keybinding-save').disabled, true);
    assert.match(f.get('keybinding-conflicts').textContent!, /New temporary session/);
    overrides.model = []; editor.reload(); assert.match(f.get('keybinding-conflicts').textContent!, /Cancel and reopen/); assert.equal(f.get<HTMLButtonElement>('keybinding-save').disabled, true);
    f.get('keybinding-record').dispatchEvent(f.event('Escape', { isComposing: true })); assert.equal(f.get<HTMLDialogElement>('keybinding-recorder').open, true);
    f.get('keybinding-record').dispatchEvent(f.event('Escape')); assert.equal(f.get<HTMLDialogElement>('keybinding-recorder').open, false);
  } finally { editor.dispose(); f.dom.window.close(); }
});

test('editor searches, records without dispatch, requires explicit reassignment, removes, and resets one/all actions', async () => {
  const f = fixture(); let overrides: KeyOverrides = {}, fail = false;
  const editor = installKeybindingEditor(f.win, f.get('settings-page').querySelector<HTMLElement>('.settings-content')!, {
    read: () => overrides,
    save: async (id, bindings, reassign) => {
      if (fail) throw new Error('disk conflict');
      const changes = changeBinding(overrides, id, bindings, reassign, true);
      for (const [key, value] of Object.entries(changes)) { if (value === undefined) delete overrides[key]; else overrides[key] = value; }
    },
    resetAll: async () => { overrides = {}; },
  });
  const ran: ActionId[] = [];
  const dispatch = installKeybindingDispatch(f.win, { read: () => overrides, enabled: () => true, run: id => { ran.push(id); }, error: () => {} });
  const click = (label: string) => f.doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  try {
    f.get<HTMLDialogElement>('settings-page').showModal(); editor.focus();
    const search = f.get<HTMLInputElement>('keybinding-search'); search.value = 'effort'; search.dispatchEvent(new f.dom.window.Event('input')); assert.equal(f.get('keybinding-list').children.length, 1);
    search.value = ''; search.dispatchEvent(new f.dom.window.Event('input'));
    click('Change Select model… shortcut ⌘+M');
    f.get('keybinding-record').dispatchEvent(f.event('n', { metaKey: true })); assert.equal(ran.length, 0);
    assert.match(f.get('keybinding-conflicts').textContent!, /New session/); assert.equal(f.get<HTMLButtonElement>('keybinding-save').disabled, true);
    f.get<HTMLInputElement>('keybinding-reassign').checked = true; f.get('keybinding-reassign').dispatchEvent(new f.dom.window.Event('change'));
    f.get<HTMLButtonElement>('keybinding-save').click(); await tick();
    assert.deepEqual(overrides, { model: ['primary+n'], new: [] }); assert.equal(f.get<HTMLDialogElement>('keybinding-recorder').open, false); assert.equal(f.doc.activeElement, search);
    click('Reset Select model…'); f.get<HTMLButtonElement>('keybinding-save').click(); await tick(); assert.equal(overrides.model, undefined);
    click('Reset New session'); f.get<HTMLButtonElement>('keybinding-save').click(); await tick(); assert.equal(overrides.new, undefined);
    click('Remove New session shortcut ⌘+N'); await tick(); assert.deepEqual(overrides.new, []);
    click('Add shortcut for New session'); f.get('keybinding-record').dispatchEvent(f.event('j', { metaKey: true }));
    fail = true; f.get<HTMLButtonElement>('keybinding-save').click(); await tick(); assert.deepEqual(overrides.new, []); assert.equal(f.get<HTMLDialogElement>('keybinding-recorder').open, true); assert.match(f.get('keybinding-status').textContent!, /disk conflict/); assert.match(f.get('keybinding-conflicts').textContent!, /disk conflict/);
    fail = false; f.get('keybinding-record').dispatchEvent(f.event('Escape')); assert.equal(f.get<HTMLDialogElement>('keybinding-recorder').open, false);
    f.get<HTMLButtonElement>('keybinding-reset-all').click(); f.get<HTMLButtonElement>('keybinding-cancel').click(); assert.deepEqual(overrides.new, []);
    f.get<HTMLButtonElement>('keybinding-reset-all').click(); f.get<HTMLButtonElement>('keybinding-save').click(); await tick(); assert.deepEqual(overrides, {});
  } finally { dispatch.dispose(); editor.dispose(); f.dom.window.close(); }
});
