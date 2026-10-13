import assert from 'node:assert/strict';
import test from 'node:test';
import { BUTTON_CONTRAST, buttonContrast, buttonDensity, buttonSurface, primaryButtonSurfaces } from '../src/button-surfaces';
import { BUILTIN_THEMES, CATALOG_THEMES } from '../src/themes/builtins';
import { themeProperties } from '../src/themes/theme';

const opacities = [0, 25, 50, 65, 85, 95, 99, 100];
test('Nimrod mint buttons keep dark text and derive enough fill density at every opacity', () => {
  const { normal, hover } = primaryButtonSurfaces('#102921', '#77d8bd', '#99e7d1');
  assert.equal(normal!.foreground, '#102921'); assert.equal(hover!.foreground, '#102921');
  assert.ok(normal!.minimum > .35);
  let last = 0;
  for (const opacity of opacities) {
    const endpoint = (opacity / 100) ** 8;
    const alpha = buttonDensity(normal!.minimum, endpoint, .35);
    const hoverAlpha = buttonDensity(Math.max(normal!.minimum, hover!.minimum), endpoint, .45);
    assert.ok(alpha >= last); last = alpha;
    assert.ok(hoverAlpha >= alpha);
    assert.ok(buttonContrast(normal!.foreground, normal!.background, alpha) >= BUTTON_CONTRAST);
    assert.ok(buttonContrast(hover!.foreground, hover!.background, hoverAlpha) >= BUTTON_CONTRAST);
  }
  assert.equal(last, 1);
  assert.equal(buttonDensity(normal!.minimum, .999999 ** 8, .35) > .9999, true);
});

test('all bundled palettes use the same primary, hover and danger contrast policy', () => {
  for (const theme of [...BUILTIN_THEMES, ...CATALOG_THEMES.map(entry => entry.theme)]) {
    const colors = themeProperties(theme);
    const { normal, hover } = primaryButtonSurfaces(colors['--vscode-button-foreground'], colors['--vscode-button-background'], colors['--vscode-button-hoverBackground']);
    const danger = buttonSurface(colors['--vscode-editor-background'], colors['--vscode-errorForeground']);
    const secondary = primaryButtonSurfaces(colors['--vscode-button-secondaryForeground'], colors['--vscode-button-secondaryBackground'], colors['--vscode-button-secondaryHoverBackground']);
    assert.ok(normal && hover && danger && secondary.normal && secondary.hover, theme.id);
    assert.equal(hover.foreground, normal.foreground, theme.id);
    for (const opacity of opacities) {
      const endpoint = (opacity / 100) ** 8;
      for (const [surface, minimum, role] of [[normal, normal.minimum, .35], [hover, Math.max(normal.minimum, hover.minimum), .45], [danger, danger.minimum, .45], [secondary.normal, secondary.normal.minimum, .10], [secondary.hover, Math.max(secondary.normal.minimum, secondary.hover.minimum), .30]] as const) {
        const density = buttonDensity(minimum, endpoint, role);
        assert.ok(buttonContrast(surface.foreground, surface.background, density) >= BUTTON_CONTRAST, `${theme.id} at ${opacity}`);
      }
    }
  }
});

test('future/imported palettes get neutral contrast repair, not theme-ID exceptions', () => {
  for (const [foreground, background] of [['#999', '#999'], ['#fff8', '#eeeeee44'], ['#111', '#222']]) {
    const surface = buttonSurface(foreground, background)!;
    assert.ok(buttonContrast(surface.foreground, surface.background, surface.minimum) >= BUTTON_CONTRAST);
    assert.match(surface.foreground, /^#[a-f\d]{6}$/);
  }
  assert.equal(buttonSurface('#fff', 'invalid'), undefined);
  const pair = primaryButtonSurfaces('#fff', '#111', '#fff');
  assert.equal(pair.hover!.foreground, pair.normal!.foreground);
  assert.equal(pair.hover!.background, pair.normal!.background);
  // Intermediate underlays can be worse than checking only black and white.
  assert.equal(buttonContrast('#888', '#888', .5), 1);
});
