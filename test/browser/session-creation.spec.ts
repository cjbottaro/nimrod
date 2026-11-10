import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('named creation combines name and eligible harness in one shared modal and Cancel preserves the current draft', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep the original draft');
    const rows = await page.locator('#open-sessions .session-row').count();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-list [data-key="new-named-with-harness"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('#palette-input')).toBeFocused();
    await expect(page.locator('#palette-name-harness')).toBeVisible();
    await expect(page.locator('#palette-name-harness option')).toHaveText(['Pi']);
    await page.locator('#palette-input').fill('Do not create');
    await page.locator('#palette-name-harness').selectOption('pi');
    await expect(page.locator('#palette-input')).toHaveValue('Do not create');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(rows);
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep the original draft');
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-list [data-key="new-with-harness"]').click();
    await expect(page.locator('#palette-list [data-key="pi"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#palette-list')).toContainText('Copilot');
    await expect(page.locator('#palette-list')).toContainText('Codex');
    await page.keyboard.press('Escape');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(rows);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
