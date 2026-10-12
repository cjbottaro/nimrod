import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('one strip keeps its position and remains actionable through Settings and nested native dialogs', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep my draft');
    await fixture.editPreferences('{"appearance.zoom":126}');
    const strip = page.locator('#application-notices');
    await expect(strip).toBeVisible(); await expect(strip).toContainText('Read settings');
    const position = await strip.boundingBox();
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-page > #application-notices')).toBeVisible();
    expect(Math.abs((await strip.boundingBox())!.y - position!.y)).toBeLessThanOrEqual(1);
    await page.locator('#settings-category-keybindings').click();
    await page.locator('.keybinding-row[data-action="sidebar"]').getByRole('button', { name: /^Add/ }).click();
    await expect(page.locator('#keybinding-recorder > #application-notices')).toBeVisible();
    expect(Math.abs((await strip.boundingBox())!.y - position!.y)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Dismiss Read settings', exact: true }).click();
    await expect(strip).toBeHidden(); await expect(page.locator('#keybinding-recorder')).toBeVisible();
    await expect(page.locator('#keybinding-record')).toBeFocused();
    await page.keyboard.press('Escape'); await page.locator('#settings-back').click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep my draft');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('runtime validation uses the strip, not an inline error or native validation popup', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click(); await page.locator('#settings-category-runtime').click();
    await page.locator('#pi-path').fill(''); await page.locator('#save-runtime').click();
    await expect(page.locator('#application-notices')).toContainText('Save runtime paths');
    await expect(page.locator('#application-notices')).toContainText('non-empty');
    await expect(page.locator('#runtime-status')).not.toContainText('Not saved');
    await expect(page.locator('#settings-page')).toBeVisible();
    await page.locator('#pi-path').fill('/fixture/pi');
    await page.locator('#save-runtime').click();
    await expect(page.locator('#application-notices')).toBeHidden();
    await expect(page.locator('#runtime-status')).toContainText('Saved.');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('connection loss before acceptance has one actionable uncertainty notice without changing focus', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.evaluate(() => {
      const state = window as unknown as { __fixtureHost(command: string, args: Record<string, unknown>): Promise<unknown>; __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      const original = state.__fixtureHost;
      state.__fixtureHost = async (command, args) => {
        if (command === 'write_pi' && (args.message as { type?: string })?.type === 'prompt') {
          state.__fixtureChannels[String(args.token)].onmessage({ kind: 'disconnected', message: 'Offline fixture disconnected before receipt' }); return;
        }
        return original(command, args);
      };
    });
    const prompt = page.locator(visible('prompt')); await prompt.fill('Maybe received'); await prompt.press('Enter');
    await expect(page.locator('#application-notices .application-notice')).toHaveCount(1);
    await expect(page.locator('#application-notices')).toContainText('Message delivery unknown');
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Maybe received');
    await expect(page.locator(visible('submission-notice'))).toBeHidden();
    await expect(page.locator('.session-view:not([hidden]) .tab-notice')).toBeHidden();
    await page.getByRole('button', { name: 'Write a new message', exact: true }).click();
    await expect(prompt).toHaveValue('');
    await expect(page.locator('#application-notices')).toContainText('Session connection');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
