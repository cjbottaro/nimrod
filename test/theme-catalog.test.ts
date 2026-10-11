import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import catalog from '../src/themes/catalog.json';
import { CATALOG_THEMES, selectedTheme } from '../src/themes/builtins';
import { importTheme, readLibrary } from '../src/themes/theme';
import { parseSettings } from '../src/preferences';

test('checked-in catalog has resolved themes, pinned provenance/licenses, and shared selection registry', () => {
  assert.equal(catalog.version, 1); assert.ok(CATALOG_THEMES.length > 200);
  assert.equal(new Set(CATALOG_THEMES.map(entry => entry.theme.id)).size, CATALOG_THEMES.length);
  for (const entry of catalog.themes) {
    assert.match(entry.id, /^catalog-/);
    assert.equal('include' in entry.theme, false); assert.ok(Array.isArray(entry.theme.tokenColors));
    const parsed = importTheme(JSON.stringify(entry.theme), 'bundled.json', entry.id).theme;
    const library = readLibrary({ version: 1, selected: entry.id, imports: [] });
    assert.equal(library.selected, entry.id);
    assert.deepEqual(selectedTheme(library), parsed);
    assert.equal(parseSettings(JSON.stringify({ 'appearance.theme': entry.id }))['appearance.theme'], entry.id);
    const source = catalog.sources[entry.source as keyof typeof catalog.sources];
    if ('registry' in source) {
      assert.match(source.registry.sha256, /^[a-f0-9]{64}$/);
      assert.equal(source.revision, source.registry.version);
    } else assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(source.licenseText.length > 100);
    for (const digest of Object.values(source.files)) assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => parseSettings('{"appearance.theme":"catalog-unknown"}'));
});

test('normal development/build tasks never run theme collection and app has no Gogh network command', () => {
  const tasks = readFileSync('mise.toml', 'utf8');
  for (const task of ['build', 'dev', 'check']) {
    const section = tasks.split(`[tasks.${task}]`)[1].split('[tasks.')[0];
    assert.doesNotMatch(section, /themes-update|cargo run|theme-bundler/);
  }
  assert.doesNotMatch(readFileSync('src/main.ts', 'utf8'), /fetch_gogh_catalog|createGoghCatalog/);
  assert.doesNotMatch(readFileSync('src-tauri/Cargo.toml', 'utf8'), /reqwest/);
});
