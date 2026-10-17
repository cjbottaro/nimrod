import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { editSettings, installPreferences, legacyPreferences, parseSettings } from '../src/preferences';
import { importTheme } from '../src/themes/theme';
import { MemoryPreferences } from './preferences-fixture';

function fixture() {
  const dom = new JSDOM('', { url: 'https://nimrod.test/' });
  const host = new MemoryPreferences();
  const errors: (string | undefined)[] = [];
  return { dom, host, errors, install: () => installPreferences(host, dom.window.localStorage, error => errors.push(error)) };
}

test('tool capture defaults off, saves globally and retains last valid settings', async () => {
  const f = fixture(), p = await f.install();
  try {
    assert.equal(p.toolCaptureEnabled(), false);
    f.host.external('// keep capture comment\n{"custom":true}');
    await p.saveToolCapture(true);
    assert.equal(p.toolCaptureEnabled(), true);
    assert.match(f.host.value.text, /keep capture comment/);
    assert.equal(parseSettings(f.host.value.text).custom, true);
    assert.throws(() => parseSettings('{"diagnostics.toolCapture":"true"}'));
    f.host.external('{"diagnostics.toolCapture":null}');
    assert.equal(p.toolCaptureEnabled(), true);
    f.host.external('{}'); assert.equal(p.toolCaptureEnabled(), false);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('JSONC edits preserve comments, unknown fields, and unrelated settings', () => {
  const text = '// Header\n{\n  // Keep this comment\n  "appearance.zoom": 125,\n  "future.option": { "url": "https://test/*text*/", },\n}\n';
  const changed = editSettings(text, { 'appearance.theme': 'dracula', 'runtime.piPath': '/bin/pi' });
  assert.match(changed, /Keep this comment/); assert.match(changed, /^\/\/ Header/);
  assert.equal(parseSettings(changed)['appearance.zoom'], 125);
  assert.deepEqual(parseSettings(changed)['future.option'], { url: 'https://test/*text*/' });
  for (const value of ['[]', '{bad}', '{"appearance.zoom":126}', '{"runtime.piPath":""}', '{"appearance.importedThemes":[{}]}']) assert.throws(() => parseSettings(value));
});

test('window appearance is global-only, preserves JSONC and retains last valid external settings', async () => {
  const f = fixture(), p = await f.install();
  try {
    assert.deepEqual(p.windowAppearance(), { opacity: 100, frosted: true, area: 'window' });
    f.host.external('// keep appearance comment\n{"custom":true}');
    f.host.value.projectPath = '/project/.nimrod/settings.json';
    f.host.externalProject('{"appearance.theme":"dracula"}');
    await p.saveWindowAppearance({ opacity: 65, frosted: false, area: 'chrome' });
    assert.deepEqual(p.windowAppearance(), { opacity: 65, frosted: false, area: 'chrome' });
    assert.match(f.host.value.text, /keep appearance comment/);
    assert.equal(parseSettings(f.host.value.text).custom, true);
    assert.equal(f.host.value.projectText, '{"appearance.theme":"dracula"}');
    for (const [key, value] of [['appearance.backgroundOpacity', 101], ['appearance.frostedBackground', null], ['appearance.translucencyArea', 'sidebar']]) {
      const text = JSON.stringify({ [key as string]: value });
      assert.throws(() => parseSettings(text)); f.host.external(text);
      assert.equal(p.windowAppearance().opacity, 65);
    }
    f.host.external('{}'); assert.equal(p.windowAppearance().opacity, 100);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('Omarchy built-ins persist and accept external settings updates', async () => {
  const f = fixture(); const p = await f.install();
  try {
    for (const selected of ['tokyo-night', 'osaka-jade']) {
      await p.saveTheme({ version: 1, selected, imports: [] });
      assert.equal(parseSettings(f.host.value.text)['appearance.theme'], selected);
      assert.equal(p.theme().selected, selected);
      f.host.external(JSON.stringify({ 'appearance.theme': selected === 'tokyo-night' ? 'osaka-jade' : 'tokyo-night' }));
      assert.notEqual(p.theme().selected, selected);
    }
    assert.throws(() => parseSettings('{"appearance.theme":"unknown"}'));
  } finally { p.dispose(); f.dom.window.close(); }
});

test('catalog acceptance preserves fresh external imports and never replaces an already-saved palette', async () => {
  const f = fixture(), p = await f.install();
  try {
    const theme = importTheme('{"colors":{"editor.background":"#102030"}}', 'fixture.json', 'import-fixture').theme;
    const other = { ...theme, id: 'import-other', name: 'Other' };
    f.host.external(JSON.stringify({ 'appearance.theme': 'nimrod', 'appearance.importedThemes': [other], custom: true }));
    await p.selectTheme(theme.id, theme);
    assert.equal(p.theme().imports.length, 2);
    assert.equal(parseSettings(f.host.value.text).custom, true);
    await p.selectTheme(theme.id, { ...theme, colors: { ...theme.colors, 'editor.background': '#445566' } });
    assert.equal(p.theme().imports.find(item => item.id === theme.id)!.colors['editor.background'], '#102030');
    await p.selectTheme('dracula');
    assert.equal(p.theme().imports.length, 2);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('send auto-follow defaults to whenIdle, preserves JSONC and synchronizes valid modes', async () => {
  const f = fixture(), p = await f.install();
  try {
    assert.equal(p.sendAutoFollow(), 'whenIdle');
    f.host.external('// keep me\n{"custom":true}');
    for (const mode of ['always', 'never', 'whenIdle'] as const) {
      await p.saveSendAutoFollow(mode);
      assert.equal(p.sendAutoFollow(), mode);
      assert.equal(parseSettings(f.host.value.text)['appearance.autoFollowAfterSending'], mode);
      assert.match(f.host.value.text, /keep me/);
      assert.equal(parseSettings(f.host.value.text).custom, true);
    }
    f.host.external('{"appearance.autoFollowAfterSending":"never"}');
    assert.equal(p.sendAutoFollow(), 'never');
    for (const mode of [null, true, 1, 'idle', {}, ['always']]) {
      const text = JSON.stringify({ 'appearance.autoFollowAfterSending': mode });
      assert.throws(() => parseSettings(text));
      f.host.external(text);
      assert.equal(p.sendAutoFollow(), 'never');
    }
    f.host.external('{}');
    assert.equal(p.sendAutoFollow(), 'whenIdle');
  } finally { p.dispose(); f.dom.window.close(); }
});

test('notifications default on, persist through JSONC edits, and retain last valid values', async () => {
  const f = fixture(); const p = await f.install();
  try {
    assert.equal(p.notificationsEnabled(), true);
    f.host.external('// keep me\n{"custom":true}');
    await p.saveNotifications(false);
    assert.equal(p.notificationsEnabled(), false);
    assert.match(f.host.value.text, /keep me/);
    assert.equal(parseSettings(f.host.value.text).custom, true);
    f.host.external('{"notifications.enabled":"false"}');
    assert.equal(p.notificationsEnabled(), false);
    assert.throws(() => parseSettings('{"notifications.enabled":null}'));
    f.host.external('{}'); assert.equal(p.notificationsEnabled(), true);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('performance diagnostics default off, preserve JSONC and synchronize only valid booleans', async () => {
  const f = fixture(), p = await f.install();
  try {
    assert.equal(p.performanceEnabled(), false);
    f.host.external('// retain comment\n{"custom":true}');
    await p.savePerformance(true);
    assert.equal(p.performanceEnabled(), true);
    assert.match(f.host.value.text, /retain comment/);
    assert.equal(parseSettings(f.host.value.text).custom, true);
    f.host.external('{"diagnostics.performance":"true"}');
    assert.equal(p.performanceEnabled(), true);
    assert.throws(() => parseSettings('{"diagnostics.performance":null}'));
    f.host.external('{}'); assert.equal(p.performanceEnabled(), false);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('legacy migration excludes drafts and never deletes their recovery sources', () => {
  const f = fixture(); const storage = f.dom.window.localStorage;
  try {
    storage.setItem('nimrod.runtime.v1', JSON.stringify({ version: 1, pi: '/old/pi', node: '/old/node' }));
    storage.setItem('nimrod.zoomPercent', '150');
    storage.setItem('nimrod.workspaces.v1', '["/project"]');
    storage.setItem('nimrod.sessions.v1:/project', '{"draft":"keep"}');
    const legacy = legacyPreferences(storage);
    assert.equal(parseSettings(legacy.text)['runtime.piPath'], '/old/pi');
    assert.equal(parseSettings(legacy.text)['appearance.zoom'], 150);
    assert.deepEqual(legacy.entries['nimrod.workspaces.v1'], ['/project']);
    assert.equal(legacy.entries['nimrod.sessions.v1:/project'], undefined);
    assert.equal(storage.getItem('nimrod.sessions.v1:/project'), '{"draft":"keep"}');
  } finally { f.dom.window.close(); }
});

test('partial legacy runtime paths preserve valid overrides and leave missing paths to discovery', () => {
  const f = fixture();
  try {
    f.dom.window.localStorage.setItem('nimrod.poc.launch', '{"pi":"/legacy/pi"}');
    const settings = parseSettings(legacyPreferences(f.dom.window.localStorage).text);
    assert.equal(settings['runtime.piPath'], '/legacy/pi');
    assert.equal(settings['runtime.nodePath'], undefined);
  } finally { f.dom.window.close(); }
});

test('file broadcasts update settings, invalid edits retain last valid values, revisions reject stale snapshots', async () => {
  const f = fixture(); const p = await f.install();
  try {
    let changes = 0; p.subscribe(() => changes++);
    f.host.external('{"appearance.zoom":150,"appearance.theme":"dracula"}');
    assert.equal(p.zoom(), 150); assert.equal(p.theme().selected, 'dracula'); assert.equal(changes, 1);
    const valid = structuredClone(f.host.value);
    f.host.external('{bad}');
    assert.equal(p.zoom(), 150); assert.match(f.errors.at(-1)!, /Keeping the last valid/);
    f.host.receive?.({ ...valid, text: '{"appearance.zoom":75}', revision: 0 });
    assert.equal(p.zoom(), 150);
    await assert.rejects(p.saveZoom(125));
    f.host.external('{}'); assert.equal(p.zoom(), 125); assert.equal(f.errors.at(-1), undefined);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('queued edits merge other-window changes and native write failures remain failures', async () => {
  const f = fixture(); const p = await f.install();
  try {
    f.host.value.text = '// External edit\n{"appearance.theme":"dracula","custom":true}';
    f.host.value.revision++;
    await Promise.all([p.saveZoom(150), p.saveRuntime({ pi: '/new/pi', node: '/new/node' })]);
    const settings = parseSettings(f.host.value.text);
    assert.equal(settings['appearance.theme'], 'dracula'); assert.equal(settings.custom, true);
    assert.equal(settings['appearance.zoom'], 150); assert.equal(settings['runtime.piPath'], '/new/pi');
    assert.match(f.host.value.text, /External edit/);
    f.host.settings = async () => { throw new Error('Disk full'); };
    await assert.rejects(p.saveZoom(175), /Disk full/); assert.equal(p.zoom(), 150);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('compare-and-swap conflicts are not retried or reported as saved', async () => {
  const f = fixture(); const p = await f.install();
  try {
    const original = f.host.settings;
    f.host.settings = async (expected, text) => {
      f.host.external('{"appearance.zoom":90}');
      return original(expected, text);
    };
    await assert.rejects(p.saveZoom(175), /Settings changed/);
    assert.equal(p.zoom(), 90);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('unchanged state requests skip IPC both while queued and after success', async () => {
  const f = fixture(), p = await f.install();
  try {
    const key = 'nimrod.tabs.v1:/project';
    let writes = 0;
    const state = f.host.state;
    f.host.state = async entries => { writes++; return state(entries); };
    const layout = { tabs: [{ path: '/session', sessionId: 'fixture', name: 'Session', lastUsed: 1 }], active: '/session' };
    const first = p.saveStateIfChanged(key, layout);
    assert.ok(first);
    for (let i = 0; i < 200; i++) assert.equal(p.saveStateIfChanged(key, structuredClone(layout)), undefined);
    await first;
    assert.equal(writes, 1);
    for (let i = 0; i < 200; i++) assert.equal(p.saveStateIfChanged(key, structuredClone(layout)), undefined);
    assert.equal(writes, 1);
    const changed = { ...layout, active: undefined };
    await p.saveStateIfChanged(key, changed);
    assert.equal(writes, 2);
    assert.equal(p.saveStateIfChanged(key, { tabs: layout.tabs }), undefined, 'equality uses persisted JSON, not undefined object fields');
    assert.deepEqual(p.readState(key), { tabs: layout.tabs });
  } finally { p.dispose(); f.dom.window.close(); }
});

test('state no-op suppression preserves A → B → A order and tracks explicit writes too', async () => {
  const f = fixture(), p = await f.install();
  try {
    await p.saveState('selected', 'A');
    const state = f.host.state;
    const writes: unknown[] = [];
    f.host.state = async entries => { writes.push(entries.selected); return state(entries); };
    const b = p.saveStateIfChanged('selected', 'B');
    const a = p.saveStateIfChanged('selected', 'A');
    assert.ok(b); assert.ok(a);
    assert.equal(p.saveStateIfChanged('selected', 'A'), undefined);
    await Promise.all([b, a]);
    assert.deepEqual(writes, ['B', 'A']);
    assert.equal(p.readState('selected'), 'A');
    writes.length = 0;
    const explicit = p.saveState('selected', 'B');
    const restore = p.saveStateIfChanged('selected', 'A');
    assert.ok(restore, 'a queued explicit B cannot be hidden by the old A snapshot');
    await Promise.all([explicit, restore]);
    assert.deepEqual(writes, ['B', 'A']);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('failed state requests are not cached as successful and are not automatically retried', async () => {
  const f = fixture(), p = await f.install();
  try {
    let writes = 0;
    const state = f.host.state;
    f.host.state = async () => { writes++; throw new Error('fixture disk full'); };
    const failed = p.saveStateIfChanged('layout', { tabs: ['a'] });
    assert.ok(failed);
    assert.equal(p.saveStateIfChanged('layout', { tabs: ['a'] }), undefined);
    await assert.rejects(failed, /fixture disk full/);
    assert.equal(writes, 1);
    assert.equal(p.readState('layout'), undefined);
    f.host.state = async entries => { writes++; return state(entries); };
    const next = p.saveStateIfChanged('layout', { tabs: ['a'] });
    assert.ok(next, 'a later request can actually save the value that failed');
    await next;
    assert.equal(writes, 2);
    assert.deepEqual(p.readState('layout'), { tabs: ['a'] });
  } finally { p.dispose(); f.dom.window.close(); }
});

test('state comparisons follow external updates/deletion and queued values are captured before mutation', async () => {
  const f = fixture(), p = await f.install();
  try {
    const original = { tabs: ['a'] };
    const saving = p.saveStateIfChanged('layout', original);
    original.tabs.push('b');
    await saving;
    assert.deepEqual(p.readState('layout'), { tabs: ['a'] });
    await f.host.state({ layout: { tabs: ['external'] }, unrelated: true });
    const restoring = p.saveStateIfChanged('layout', { tabs: ['a'] });
    assert.ok(restoring); await restoring;
    assert.equal(p.readState('unrelated'), true);
    f.host.value.state = { version: 1 }; f.host.value.revision++;
    f.host.receive?.(await f.host.snapshot());
    const recreate = p.saveStateIfChanged('layout', { tabs: ['a'] });
    assert.ok(recreate); await recreate;
    assert.deepEqual(p.readState('layout'), { tabs: ['a'] });
  } finally { p.dispose(); f.dom.window.close(); }
});

test('state writes merge keys and do not alter settings or draft storage', async () => {
  const f = fixture(); const p = await f.install();
  try {
    const text = f.host.value.text;
    await Promise.all([p.saveState('nimrod.tabs.v1:/a', { tabs: ['a'] }), p.saveState('nimrod.tabs.v1:/b', { tabs: ['b'] })]);
    assert.deepEqual(p.readState('nimrod.tabs.v1:/a'), { tabs: ['a'] });
    assert.deepEqual(p.readState('nimrod.tabs.v1:/b'), { tabs: ['b'] });
    assert.equal(f.host.value.text, text); assert.equal(f.dom.window.localStorage.length, 0);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('project overrides merge over global defaults and reset removes keys rather than copying values', async () => {
  const f = fixture();
  f.host.value.state.legacyMigrated = true;
  f.host.value.text = '// Global\n{"appearance.theme":"dracula","appearance.zoom":150,"appearance.autoFollowAfterSending":"never","runtime.nodePath":"/global/node"}';
  f.host.value.projectPath = '/fixture/project/.nimrod/settings.json';
  f.host.value.projectText = '// Project\n{}';
  const p = await f.install();
  try {
    assert.equal(p.zoom(), 150); assert.equal(p.isOverridden('appearance.theme'), false);
    await p.selectTheme('dracula');
    assert.equal(p.isOverridden('appearance.theme'), true, 'same-valued explicit choice remains an override');
    f.host.external('// Global\n{"appearance.theme":"tokyo-night","appearance.zoom":175,"appearance.autoFollowAfterSending":"always","runtime.nodePath":"/new/node"}');
    assert.equal(p.theme().selected, 'dracula'); assert.equal(p.zoom(), 175); assert.equal(p.sendAutoFollow(), 'always');
    await p.saveRuntime({ pi: '/project/pi', node: '/new/node' }, ['pi']);
    assert.deepEqual(p.runtime({ pi: 'pi', node: 'node' }), { version: 1, pi: '/project/pi', node: '/new/node', copilot: 'copilot' });
    assert.equal(p.isOverridden('runtime.nodePath'), false);
    await p.useGlobal('appearance.theme');
    assert.equal(p.theme().selected, 'tokyo-night'); assert.equal(p.isOverridden('appearance.theme'), false);
    assert.match(f.host.value.projectText!, /Project/); assert.match(f.host.value.text, /Global/);
    f.host.externalProject('{}');
    assert.equal(p.runtime({ pi: 'pi', node: 'node' }).pi, 'pi');
    assert.equal(p.isOverridden('runtime.piPath'), false);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('global-only preferences stay global from a project and project revisions reject stale overrides', async () => {
  const f = fixture();
  f.host.value.state.legacyMigrated = true;
  f.host.value.projectPath = '/fixture/project/.nimrod/settings.json';
  f.host.value.projectText = '{"appearance.theme":"dracula","appearance.zoom":110,"appearance.autoFollowAfterSending":"always"}';
  const p = await f.install();
  try {
    const before = f.host.value.projectText;
    await p.saveNotifications(false); await p.savePerformance(true); await p.resetKeybindings();
    await p.saveZoom(175); await p.saveSendAutoFollow('never');
    assert.equal(f.host.value.projectText, before);
    assert.equal(parseSettings(f.host.value.text)['notifications.enabled'], false);
    assert.equal(p.zoom(), 175); assert.equal(p.sendAutoFollow(), 'never');
    const old = await f.host.snapshot();
    f.host.externalProject('{"appearance.theme":"tokyo-night"}');
    f.host.receive?.(old);
    assert.equal(p.theme().selected, 'tokyo-night');
    f.host.externalProject('{broken}');
    assert.equal(p.theme().selected, 'tokyo-night');
    await assert.rejects(p.selectTheme('nimrod'));
    await p.saveZoom(90);
    assert.equal(p.zoom(), 90, 'a malformed project cannot block an independent global edit');
    assert.equal(f.host.value.projectText, '{broken}');
    f.host.externalProject('{}');
    assert.equal(p.theme().selected, 'nimrod');
    await p.selectTheme('osaka-jade');
    const saved = f.host.value.projectText;
    f.host.projectSettings = async () => { throw new Error('Fixture conflict'); };
    await assert.rejects(p.selectTheme('dracula'), /Fixture conflict/);
    assert.equal(f.host.value.projectText, saved); assert.equal(p.theme().selected, 'osaka-jade');
  } finally { p.dispose(); f.dom.window.close(); }
});

test('obsolete project zoom and auto-follow entries are ignored without rewriting or promoting them', async () => {
  const f = fixture();
  f.host.value.state.legacyMigrated = true;
  f.host.value.projectPath = '/fixture/project/.nimrod/settings.json';
  const original = '// Retain comments and obsolete keys\n{"appearance.zoom":75,"appearance.autoFollowAfterSending":"always"}';
  f.host.value.projectText = original;
  const p = await f.install();
  try {
    assert.equal(p.zoom(), 125); assert.equal(p.sendAutoFollow(), 'whenIdle');
    assert.equal(f.host.value.projectText, original); assert.equal(f.host.value.text, '{}\n');
    f.host.external('{"appearance.zoom":150,"appearance.autoFollowAfterSending":"never"}');
    assert.equal(p.zoom(), 150); assert.equal(p.sendAutoFollow(), 'never');
    await p.selectTheme('dracula');
    assert.match(f.host.value.projectText!, /Retain comments/);
    assert.equal(parseSettings(f.host.value.projectText!)['appearance.zoom'], 75);
    f.host.externalProject('{"appearance.theme":"dracula","appearance.zoom":null,"appearance.autoFollowAfterSending":"obsolete"}');
    assert.equal(p.theme().selected, 'dracula'); assert.equal(p.zoom(), 150); assert.equal(p.sendAutoFollow(), 'never');
    assert.equal(f.errors.at(-1), undefined);
  } finally { p.dispose(); f.dom.window.close(); }
});

test('project theme selection uses the shared global library without duplicating imports', async () => {
  const f = fixture();
  const theme = importTheme('{"colors":{"editor.background":"#102030"}}', 'fixture.json', 'import-fixture').theme;
  f.host.value.state.legacyMigrated = true;
  f.host.value.text = JSON.stringify({ 'appearance.importedThemes': [theme] });
  f.host.value.projectPath = '/fixture/project/.nimrod/settings.json';
  f.host.value.projectText = '{}';
  const p = await f.install();
  try {
    await p.selectTheme(theme.id);
    assert.equal(p.theme().selected, theme.id); assert.equal(p.theme().imports.length, 1);
    assert.equal(JSON.parse(f.host.value.projectText!)['appearance.importedThemes'], undefined);
    await assert.rejects(p.saveTheme({ version: 1, selected: 'nimrod', imports: [] }), /global Settings/);
    f.host.external('{}');
    assert.equal(p.theme().selected, theme.id, 'removing a global import retains the last valid effective palette');
    await p.useGlobal('appearance.theme');
    assert.equal(p.theme().selected, 'nimrod');
  } finally { p.dispose(); f.dom.window.close(); }
});
