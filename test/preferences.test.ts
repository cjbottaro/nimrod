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

test('JSONC edits preserve comments, unknown fields, and unrelated settings', () => {
  const text = '// Header\n{\n  // Keep this comment\n  "appearance.zoom": 125,\n  "future.option": { "url": "https://test/*text*/", },\n}\n';
  const changed = editSettings(text, { 'appearance.theme': 'dracula', 'runtime.piPath': '/bin/pi' });
  assert.match(changed, /Keep this comment/); assert.match(changed, /^\/\/ Header/);
  assert.equal(parseSettings(changed)['appearance.zoom'], 125);
  assert.deepEqual(parseSettings(changed)['future.option'], { url: 'https://test/*text*/' });
  for (const value of ['[]', '{bad}', '{"appearance.zoom":126}', '{"runtime.piPath":""}', '{"appearance.importedThemes":[{}]}']) assert.throws(() => parseSettings(value));
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
