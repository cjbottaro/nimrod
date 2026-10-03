import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('fresh offline session model and effort controls share the searchable palette', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep unsent');
    await page.locator(visible('model')).click();
    await expect(page.locator('#palette-title')).toHaveText('Select model');
    await expect(page.locator('#palette-list')).toContainText('fixture/offline-demo');
    await expect(page.locator('#host-dialog')).not.toBeVisible();
    await page.locator('#palette-input').fill('offline');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('model'))).toBeEnabled();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('effort');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Select thinking level');
    await expect(page.locator('#palette-list')).toContainText('Current');
    await page.locator('#palette-input').fill('high');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('thinking'))).toHaveText('high');
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep unsent');
    expect(demo.calls.some(c => (c.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
