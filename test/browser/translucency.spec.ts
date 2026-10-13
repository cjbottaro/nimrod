import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
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
      await send.hover(); expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(windowSurfaceOpacities(65).buttonHover, 3);
      await page.locator('#toggle-sidebar').hover();
      expect(alpha(await page.locator('#toggle-sidebar').evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(windowSurfaceOpacities(65).state, 3);
      // The notice's error outline/icon and foreground opacity remain untouched.
      expect(await notices.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': 65, 'appearance.translucencyArea': 'chrome', 'appearance.frostedBackground': false }));
      await expect(page.locator('html')).toHaveAttribute('data-translucency', 'chrome');
      expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      expect(alpha(await notices.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      expect(alpha(await page.locator('#sidebar-new').evaluate(node => getComputedStyle(node).backgroundColor))).toBeCloseTo(windowSurfaceOpacities(65).button, 3);
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
      for (const opacity of [0, 25, 50, 65, 85, 95, 99, 100]) {
        await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity, 'appearance.frostedBackground': false }));
        await expect(page.locator('html')).toHaveAttribute('data-translucency', opacity === 100 ? 'off' : 'window');
        const color = async (selector: string) => page.locator(selector).evaluate(node => getComputedStyle(node).backgroundColor);
        const base = alpha(await color(opacity === 100 ? 'html' : '#workspace-content'));
        const interaction = alpha(await color(visible('composer-area')));
        const panel = alpha(await color(visible('activity')));
        const notice = alpha(await color(visible('session-notices')));
        const button = alpha(await color('#sidebar-new'));
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

test('whole-window and chrome-only tint synchronize without rebuilding the conversation', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep this draft');
    await page.evaluate(() => {
      (window as Window & { __appearancePrompt?: Element }).__appearancePrompt = document.querySelector('.session-view:not([hidden]) [data-pi-id="prompt"]')!;
    });
    const settings = await fixture.settingsWindow();
    await expect(settings.locator('#settings-translucency')).toBeVisible();
    await expect(settings.locator('#settings-frosted-background')).toBeVisible();
    await settings.locator('#background-opacity').evaluate((input: HTMLInputElement) => {
      input.value = '65'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(settings.locator('html')).toHaveAttribute('data-translucency', 'window');
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
