import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

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
      for (const opacity of surfaceAlphas) expect(opacity).toBeCloseTo(.13, 3);
      const buttons = await page.locator('button').evaluateAll(buttons => buttons.filter(button => {
        const style = getComputedStyle(button);
        return button.getClientRects().length && style.visibility !== 'hidden';
      }).map(button => ({ id: button.id || button.dataset.piId || button.className, background: getComputedStyle(button).backgroundColor })));
      expect(buttons.length).toBeGreaterThan(3);
      for (const button of buttons) expect(alpha(button.background), button.id).toBeLessThan(1);
      const send = page.locator(visible('send'));
      await send.hover(); expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(.45);
      await page.locator('#toggle-sidebar').hover();
      expect(alpha(await page.locator('#toggle-sidebar').evaluate(node => getComputedStyle(node).backgroundColor))).toBe(.3);
      // The notice's error outline/icon and foreground opacity remain untouched.
      expect(await notices.evaluate(node => getComputedStyle(node).opacity)).toBe('1');
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': 65, 'appearance.translucencyArea': 'chrome', 'appearance.frostedBackground': false }));
      await expect(page.locator('html')).toHaveAttribute('data-translucency', 'chrome');
      expect(alpha(await send.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      expect(alpha(await notices.evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
      expect(alpha(await page.locator('#sidebar-new').evaluate(node => getComputedStyle(node).backgroundColor))).toBe(.3);
    }
    await fixture.editPreferences('{}');
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'off');
    expect(alpha(await page.locator('#sidebar-new').evaluate(node => getComputedStyle(node).backgroundColor))).toBe(1);
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
