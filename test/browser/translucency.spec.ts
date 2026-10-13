import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

// Offline WebKit CSS evidence only: native transparency/vibrancy is mocked.
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
