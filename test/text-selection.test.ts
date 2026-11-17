import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonContrast } from '../src/button-surfaces';
import { textSelectionSurface, SELECTION_PAINT_ALPHA, SELECTION_SURFACE_CONTRAST, SELECTION_TEXT_CONTRAST } from '../src/text-selection';
import { titlebarTint } from '../src/window-appearance';
import { BUILTIN_THEMES, CATALOG_THEMES } from '../src/themes/builtins';
import { importTheme, themeProperties } from '../src/themes/theme';

function check(surface: string, selection: string, foreground: string) {
  const pair = textSelectionSurface(surface, selection, foreground);
  assert.match(pair.background, /^#[a-f\d]{6}fe$/);
  assert.match(pair.foreground, /^#[a-f\d]{6}$/);
  const backing = titlebarTint(surface, 100)!, fill = titlebarTint(pair.background, 100)!;
  const painted = '#' + fill.slice(0, 3).map((c, i) => Math.round(c * SELECTION_PAINT_ALPHA + backing[i] * (1 - SELECTION_PAINT_ALPHA)).toString(16).padStart(2, '0')).join('');
  assert.ok(buttonContrast(painted, surface, 1) >= SELECTION_SURFACE_CONTRAST, `${surface}: ${JSON.stringify(pair)}`);
  assert.ok(buttonContrast(pair.foreground, pair.background, SELECTION_PAINT_ALPHA) >= SELECTION_TEXT_CONTRAST, JSON.stringify(pair));
  return pair;
}

test('all bundled/catalog palettes get readable, visible text selection on each nominal backing', () => {
  for (const theme of [...BUILTIN_THEMES, ...CATALOG_THEMES.map(entry => entry.theme)]) {
    const colors = themeProperties(theme);
    const original = JSON.stringify(theme);
    for (const role of ['editor-background', 'input-background', 'textCodeBlock-background', 'editorWidget-background']) {
      check(colors[`--vscode-${role}`], colors['--vscode-selection-background'], colors['--vscode-editor-selectionForeground']);
    }
    assert.equal(JSON.stringify(theme), original, theme.id);
  }
});

test('readable RGB pairs stay unchanged with the WebKit-safe alpha; subdued/unreadable pairs are repaired', () => {
  assert.deepEqual(check('#151c20', '#77d8bd', '#102921'), { background: '#77d8bdfe', foreground: '#102921' });
  assert.deepEqual(check('#ffffff', '#287c69', '#ffffff'), { background: '#287c69fe', foreground: '#ffffff' });
  const night = check('#1a1b26', '#292e42', '#a9b1d6');
  assert.notEqual(night.background.slice(0, 7), '#292e42');
  const repaired = check('#000000', '#ffffff', '#ffffff');
  assert.equal(repaired.foreground, '#000000');
});

test('alpha, missing, identical and mid-tone imported colors use the same policy', () => {
  for (const surface of ['#000000', '#111c18', '#777777', '#999999', '#ffffff']) {
    for (const selection of ['#fff0', '#1234', '#292e4240', '#ffffff80', surface, 'invalid']) {
      check(surface, selection, '#fff8');
    }
  }
  // Check all gray backings, including near the direction crossover.
  for (let channel = 0; channel < 256; channel++) {
    const gray = '#' + channel.toString(16).padStart(2, '0').repeat(3);
    check(gray, gray, gray);
  }
  const theme = importTheme(JSON.stringify({ colors: {
    'editor.background': '#123456', 'editor.selectionBackground': '#12345600', 'editor.selectionForeground': '#123456',
  } }), 'future.json', 'import-future').theme;
  check(theme.colors['editor.background'], theme.colors['editor.selectionBackground'], theme.colors['editor.selectionForeground']);
});

test('missing selection colors derive a subdued accent rather than a full-strength focus fill', () => {
  const pair = textSelectionSurface('#151c20', '', '#d8e0e3', '#77d8bd');
  assert.notEqual(pair.background, '#77d8bdfe');
  assert.ok(titlebarTint(pair.background, 100)![1] < 160);
  assert.ok(buttonContrast(pair.foreground, pair.background, SELECTION_PAINT_ALPHA) >= SELECTION_TEXT_CONTRAST);
});

test('general text selection stays independent of editor and list selections', () => {
  const base = { id: 'selection', name: 'Selection', mode: 'dark' as const, syntax: {}, colors: {
    'editor.background': '#111111', 'list.focusBackground': '#222222', 'selection.background': '#345678',
  } };
  let colors = themeProperties(base);
  assert.equal(colors['--vscode-editor-selectionBackground'], '#345678');
  assert.equal(colors['--vscode-list-focusBackground'], '#222222');
  colors = themeProperties({ ...base, colors: { ...base.colors, 'editor.selectionBackground': '#abcdef' } });
  assert.equal(colors['--vscode-editor-selectionBackground'], '#abcdef');
  assert.equal(colors['--vscode-selection-background'], '#345678');
  assert.equal(colors['--vscode-list-focusBackground'], '#222222');
  const sweet = CATALOG_THEMES.find(entry => entry.theme.name === 'Sweet Dracula')!.theme;
  const original = JSON.stringify(sweet);
  const props = themeProperties(sweet);
  assert.equal(props['--vscode-selection-background'], '#BD93F9');
  assert.equal(props['--vscode-editor-selectionBackground'], '#2F3438');
  assert.equal(JSON.stringify(sweet), original);
});
