import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { buttonContrast, buttonSurface } from '../../src/button-surfaces';
import { windowSurfaceOpacities } from '../../src/window-appearance';

function alpha(color: string): number {
  const match = /\/\s*([\d.]+)\s*\)$/.exec(color) ?? /rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(color);
  return match ? Number(match[1]) : 1;
}

// Offline WebKit CSS evidence only: native transparency/vibrancy is mocked.
test('buttons, Status area and notices use translucent overlays rather than stacked opaque fills', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const token = String(fixture.calls.find(call => call.command === 'start_pi')!.args.token);
    await page.evaluate(token => {
      const host = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      host.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', notifyType: 'error', id: 'translucent-notice', message: 'Fixture session notice' } });
    }, token);
    const notices = page.locator(visible('session-notices'));
    await expect(notices).toBeVisible();
    for (const theme of ['dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': 65, 'appearance.frostedBackground': false }));
      await expect(page.locator('html')).toHaveAttribute('data-translucency', 'window');
      const surfaceAlphas: number[] = [];
      for (const selector of [visible('composer-area'), visible('activity'), visible('session-notices')]) {
        const color = await page.locator(selector).evaluate(node => getComputedStyle(node).backgroundColor);
        surfaceAlphas.push(alpha(color));
      }
      const densities = windowSurfaceOpacities(65);
      expect(surfaceAlphas[0]).toBeCloseTo(densities.control, 3);
      expect(surfaceAlphas[1]).toBeCloseTo(densities.panel, 3);
      expect(surfaceAlphas[2]).toBeCloseTo(densities.panel, 3);
      const buttons = await page.locator('button').evaluateAll(buttons => buttons.filter(button => {
        const style = getComputedStyle(button);
        return button.getClientRects().length && style.visibility !== 'hidden';
      }).map(button => ({ id: button.id || button.dataset.piId || button.className, background: getComputedStyle(button).backgroundColor })));
      expect(buttons.length).toBeGreaterThan(3);
      for (const button of buttons) expect(alpha(button.background), button.id).toBeLessThan(1);
      const send = page.locator(visible('send'));
      await send.hover();
      const hoverDensity = await page.locator('html').evaluate(root => parseFloat(getComputedStyle(root).getPropertyValue('--nimrod-button-hover-opacity')) / 100);
      expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(hoverDensity, 3);
      await page.locator('#toggle-sidebar').hover();
      const secondaryHoverDensity = await page.locator('html').evaluate(root => parseFloat(getComputedStyle(root).getPropertyValue('--nimrod-sidebar-secondary-hover-opacity')) / 100);
      expect(alpha(await page.locator('#toggle-sidebar').evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(secondaryHoverDensity, 3);
      // The notice's error outline/icon and foreground opacity remain untouched.
      expect(await notices.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': 65, 'appearance.translucencyArea': 'chrome', 'appearance.frostedBackground': false }));
      await expect(page.locator('html')).toHaveAttribute('data-translucency', 'chrome');
      expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      expect(alpha(await notices.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      const primaryDensity = await page.locator('html').evaluate(root => parseFloat(getComputedStyle(root).getPropertyValue('--nimrod-sidebar-button-opacity')) / 100);
      expect(alpha(await page.locator('#sidebar-new').evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(primaryDensity, 3);
    }
    await fixture.editPreferences('{}');
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'off');
    expect(alpha(await page.locator('#sidebar-new').evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Status area, notices and buttons retain hierarchy across the slider, including 99 to 100', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const token = String(fixture.calls.find(call => call.command === 'start_pi')!.args.token);
    await page.evaluate(token => {
      const host = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      host.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', notifyType: 'error', id: 'hierarchy-notice', message: 'Keep a distinct notice surface' } });
    }, token);
    for (const theme of ['nimrod', 'dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
      let lastPanel = 0;
      for (const opacity of [0, 25, 50, 65, 85, 90, 95, 99, 100]) {
        await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity, 'appearance.frostedBackground': false }));
        await expect(page.locator('html')).toHaveAttribute('data-translucency', opacity === 100 ? 'off' : 'window');
        const color = async (selector: string) => page.locator(selector).evaluate(node => getComputedStyle(node).backgroundColor);
        const base = alpha(await color(opacity === 100 ? 'html' : '#workspace-content'));
        const interaction = alpha(await color(visible('composer-area')));
        const panel = alpha(await color(visible('activity')));
        const notice = alpha(await color(visible('session-notices')));
        const button = alpha(await color('#sidebar-new'));
        const primary = await page.locator('#sidebar-new').evaluate(node => {
          const style = getComputedStyle(node);
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          const hex = (value: string) => {
            context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
            return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
          };
          return { foreground: hex(style.color), background: hex(style.backgroundColor), opacity: style.opacity,
            underlay: getComputedStyle(document.getElementById('session-sidebar')!).getPropertyValue('--vscode-editorWidget-background').trim() };
        });
        expect(primary.opacity).toBe('1');
        if (theme === 'nimrod' && opacity === 90) {
          const conservative = await page.locator('html').evaluate(root => parseFloat(getComputedStyle(root).getPropertyValue('--nimrod-button-opacity')) / 100);
          expect(button).toBeLessThan(conservative);
          expect(button).toBeLessThan(.71);
        }
        // Canvas readback quantizes alpha/unpremultiplied channels to 8-bit.
        expect(buttonContrast(primary.foreground, primary.background, button, { color: primary.underlay, opacity: opacity / 100 })).toBeGreaterThan(4.4);
        expect(panel).toBeGreaterThanOrEqual(lastPanel); lastPanel = panel;
        if (opacity < 100) {
          expect(panel).toBeGreaterThan(interaction);
          expect(base + (1 - base) * notice).toBeGreaterThan(base);
          expect(button).toBeLessThan(1);
          if (opacity === 99) { expect(panel).toBeGreaterThan(.9); expect(button).toBeGreaterThan(.9); }
        } else {
          expect([base, interaction, panel, notice, button]).toEqual([1, 1, 1, 1, 1]);
          // Force only the CSS's limit at p=1: it must match the normal opaque
          // recipe, including palette colors/foregrounds, not just alpha=1.
          const endpoint = await page.evaluate(() => {
            const root = document.documentElement;
            const selectors = ['[data-pi-id="activity"]', '.session-notices', '#sidebar-new', '#toggle-sidebar'];
            const pixel = (color: string) => {
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
              const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data];
            };
            const snapshot = () => selectors.map(selector => {
              const style = getComputedStyle(document.querySelector(selector)!);
              return { background: pixel(style.backgroundColor), foreground: pixel(style.color) };
            });
            const opaque = snapshot(); root.dataset.translucency = 'window';
            const limit = snapshot(); root.dataset.translucency = 'off';
            return { opaque, limit };
          });
          expect(endpoint.limit).toEqual(endpoint.opaque);
        }
      }
    }
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('normal and hovered primary fills do not exceed the pre-glass recipe at matching settings', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const theme of ['nimrod', 'dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
        for (const area of ['window', 'chrome']) {
          for (const opacity of [0, 25, 50, 65, 85, 90, 95, 99, 100]) {
            await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity, 'appearance.translucencyArea': area }));
            for (const hovered of [false, true]) {
              if (hovered) await page.locator('#sidebar-new').hover(); else await page.mouse.move(799, 1);
              const palette = await page.locator('html').evaluate(root => {
                const style = getComputedStyle(root);
                return ['--nimrod-primary-foreground', '--nimrod-primary-background', '--nimrod-primary-hover-background'].map(key => style.getPropertyValue(key).trim());
              });
              const normal = buttonSurface(palette[0], palette[1])!;
              const hover = buttonSurface(palette[0], palette[2])!;
              const floor = hovered ? Math.max(normal.minimum, hover.minimum, .45) : Math.max(normal.minimum, .35);
              const previousDensity = floor + (1 - floor) * (opacity / 100) ** 8;
              const comparison = await page.locator('#sidebar-new').evaluate((button: HTMLElement, { hovered, previousDensity }) => {
                const root = getComputedStyle(document.documentElement);
                const current = getComputedStyle(button).backgroundColor;
                const saved = button.style.background;
                const color = root.getPropertyValue(hovered ? '--nimrod-primary-hover-background' : '--nimrod-primary-background');
                const density = `${previousDensity * 100}%`;
                // The previous implementation resolved this fill at the root,
                // with no local parent-tint credit. Compare on the actual node.
                button.style.background = document.documentElement.dataset.translucency === 'off' ? color : `color-mix(in srgb, ${color} ${density}, transparent)`;
                const previous = getComputedStyle(button).backgroundColor;
                button.style.background = saved;
                return { current, previous };
              }, { hovered, previousDensity });
              expect(alpha(comparison.current), `${scheme}/${theme}/${area}/${opacity}/${hovered}`).toBeLessThanOrEqual(alpha(comparison.previous) + .000001);
            }
          }
        }
      }
    }
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('an uncommitted drag updates project windows and native Settings close restores the saved opacity', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences(JSON.stringify({ 'appearance.theme': 'dracula', 'appearance.backgroundOpacity': 65 }));
    const settings = await fixture.settingsWindow();
    const before = fixture.settingsText();
    const writes = fixture.calls.filter(call => call.command === 'preferences_settings').length;
    await settings.locator('#background-opacity').evaluate((input: HTMLInputElement) => {
      for (const opacity of [45, 20, 10]) { input.value = String(opacity); input.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await expect(page.locator('html')).toHaveCSS('--nimrod-background-opacity', '10%');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
    expect(fixture.settingsText()).toBe(before);
    expect(fixture.calls.filter(call => call.command === 'preferences_settings').length).toBe(writes);
    await settings.close();
    await expect(page.locator('html')).toHaveCSS('--nimrod-background-opacity', '65%');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('whole-window and chrome-only tint synchronize without rebuilding the conversation', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep this draft');
    await page.evaluate(() => {
      (window as Window & { __appearancePrompt?: Element }).__appearancePrompt = document.querySelector('.session-view:not([hidden]) [data-pi-id="prompt"]')!;
    });
    const settings = await fixture.settingsWindow();
    const before = fixture.settingsText();
    const writes = () => fixture.calls.filter(call => call.command === 'preferences_settings').length;
    const beforeWrites = writes();
    await expect(settings.locator('#settings-translucency')).toBeVisible();
    await expect(settings.locator('#settings-frosted-background')).toBeVisible();
    await settings.locator('#background-opacity').evaluate((input: HTMLInputElement) => {
      input.value = '65'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(settings.locator('html')).toHaveAttribute('data-translucency', 'window');
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'window');
    await expect(page.locator('html')).toHaveCSS('--nimrod-background-opacity', '65%');
    expect(fixture.settingsText()).toBe(before); expect(writes()).toBe(beforeWrites);
    await settings.locator('#background-opacity').evaluate(input => input.dispatchEvent(new Event('change', { bubbles: true })));
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'window');
    const wholeBackground = await page.locator('#workspace-content').evaluate(element => getComputedStyle(element).backgroundColor);
    await settings.locator('#translucency-area').selectOption('chrome');
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'chrome');
    const chromeBackground = await page.locator('#workspace-content').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(chromeBackground).not.toEqual(wholeBackground);
    const sidebarBackground = await page.locator('#session-sidebar').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(sidebarBackground).not.toEqual(chromeBackground);
    // Settings reveals the desktop backing, never the conversation under its modal.
    await page.locator('#open-settings').click();
    await expect(page.locator('#workspace-layout')).toHaveCSS('visibility', 'hidden');
    await page.locator('#settings-back').click();
    await expect(page.locator('#workspace-layout')).toHaveCSS('visibility', 'visible');
    await expect(prompt).toHaveValue('Keep this draft');
    expect(await page.evaluate(() => (window as Window & { __appearancePrompt?: Element }).__appearancePrompt === document.querySelector('.session-view:not([hidden]) [data-pi-id="prompt"]'))).toBe(true);
    const nativeEffects = fixture.calls.filter(call => call.command === 'apply_window_appearance');
    expect(nativeEffects.some(call => call.args.frosted === true)).toBe(true);
    await settings.locator('#frosted-background').uncheck();
    await expect.poll(() => fixture.calls.filter(call => call.command === 'apply_window_appearance').at(-1)?.args.frosted).toBe(false);
    await fixture.editPreferences('{}');
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'off');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
