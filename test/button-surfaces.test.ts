import assert from 'node:assert/strict';
import test from 'node:test';
import { BUTTON_CONTRAST, buttonContrast, buttonDensity, buttonSurface, primaryButtonSurfaces, buttonUnderlayCredit, tintedButtonDensity } from '../src/button-surfaces';
import { BUILTIN_THEMES, CATALOG_THEMES } from '../src/themes/builtins';
import { themeProperties } from '../src/themes/theme';

const opacities = [0, 25, 50, 65, 85, 90, 95, 99, 100];
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

test('90% does not ramp opacity upward from an already sufficient contrast floor', () => {
  const surface = buttonSurface('#102921', '#77d8bd')!;
  const p = .9, density = buttonDensity(surface.minimum, p ** 8, .35);
  assert.equal(density, surface.minimum);
  const fill = tintedButtonDensity(density, p, buttonUnderlayCredit(surface, '#182126'), .35);
  assert.ok(fill > .60 && fill < .68);
  assert.ok(buttonContrast(surface.foreground, surface.background, fill, { color: '#182126', opacity: p }) >= BUTTON_CONTRAST);
  assert.ok(p + (1 - p) * fill < .97);
  assert.equal(buttonDensity(surface.minimum, 1, .35), 1);
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
      for (const [surface, minimum, role] of [[normal, normal.minimum, .35], [hover, Math.max(normal.minimum, hover.minimum), .45], [normal, normal.minimum, .18], [hover, Math.max(normal.minimum, hover.minimum), .32], [danger, danger.minimum, .45], [secondary.normal, secondary.normal.minimum, .10], [secondary.hover, Math.max(secondary.normal.minimum, secondary.hover.minimum), .30]] as const) {
        const density = buttonDensity(minimum, endpoint, role);
        assert.ok(buttonContrast(surface.foreground, surface.background, density) >= BUTTON_CONTRAST, `${theme.id} at ${opacity}`);
      }
    }
  }
});

test('known tinted parents permit modestly glassier buttons without reducing contrast', () => {
  const normal = buttonSurface('#102921', '#77d8bd')!;
  const density = buttonDensity(normal.minimum, .65 ** 8, .35);
  const credit = buttonUnderlayCredit(normal, '#182126');
  const tinted = tintedButtonDensity(density, .65, credit, .35);
  assert.ok(tinted < density);
  assert.ok(buttonContrast(normal.foreground, normal.background, tinted, { color: '#182126', opacity: .65 }) >= BUTTON_CONTRAST);
  assert.equal(buttonUnderlayCredit(normal, 'unknown'), 0);
  assert.equal(buttonUnderlayCredit(normal, '#18212600'), 0);
  assert.ok(tintedButtonDensity(density, .65, 0, .35) >= density);
  assert.equal(tintedButtonDensity(1, 1, 1, .35), 1);
});

test('all palettes retain contrast and monotonic composited density over tinted chrome/modal surfaces', () => {
  for (const theme of [...BUILTIN_THEMES, ...CATALOG_THEMES.map(entry => entry.theme)]) {
    const colors = themeProperties(theme);
    const surfaces = [
      [buttonSurface(colors['--vscode-button-foreground'], colors['--vscode-button-background'])!, .35],
      [buttonSurface(colors['--vscode-button-foreground'], colors['--vscode-button-background'])!, .18],
      [buttonSurface(colors['--vscode-button-secondaryForeground'], colors['--vscode-button-secondaryBackground'])!, .10],
      [buttonSurface(colors['--vscode-editor-background'], colors['--vscode-errorForeground'])!, .45],
    ] as const;
    for (const color of [colors['--vscode-editor-background'], colors['--vscode-editorWidget-background']]) {
      for (const [surface, role] of surfaces) {
        for (const modal of [false, true]) {
          const credit = buttonUnderlayCredit(surface, color);
          let last = 0;
          for (let step = 0; step <= 100; step++) {
            const p = step / 100, endpoint = p ** 8;
            const parent = modal ? .72 + .28 * endpoint : p;
            const density = buttonDensity(surface.minimum, endpoint, role);
            const tinted = tintedButtonDensity(density, parent, credit, role, endpoint);
            assert.ok(tinted <= density + .000001, theme.id);
            assert.ok(buttonContrast(surface.foreground, surface.background, tinted, { color, opacity: parent }) >= BUTTON_CONTRAST, `${theme.id} at ${p}`);
            const effective = parent + (1 - parent) * tinted;
            assert.ok(effective >= last - .000001, `${theme.id} density at ${p}`); last = effective;
          }
          assert.equal(last, 1);
        }
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
