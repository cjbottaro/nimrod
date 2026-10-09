import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('sidebar trash is left of Close, shares row hover and remains disabled for offline demos in both views', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const row = page.locator('#open-sessions .open-session').first();
    const trash = row.locator('.session-delete'), close = row.locator('.session-close');
    await expect(trash).toBeVisible(); await expect(trash).toBeDisabled();
    await expect(trash).toHaveAttribute('aria-label', /Delete session tree for /);
    await expect(trash.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(await trash.evaluate(button => button.nextElementSibling?.className)).toBe('session-close');
    const separator = page.getByRole('separator', { name: 'Resize session sidebar' }); await separator.focus(); await separator.press('Home');
    const trashBox = (await trash.boundingBox())!, closeBox = (await close.boundingBox())!, rowBox = (await row.boundingBox())!;
    expect(trashBox.x + trashBox.width).toBeLessThanOrEqual(closeBox.x);
    expect(Math.abs(trashBox.y - closeBox.y)).toBeLessThanOrEqual(1);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    await trash.hover();
    const color = await row.evaluate(node => getComputedStyle(node).backgroundColor);
    await expect(trash).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await close.hover(); expect(await row.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(color);
    await trash.click({ force: true }); expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    await page.locator(visible('prompt')).fill('Finish in the background'); await page.locator(visible('prompt')).press('Enter');
    await page.getByRole('tab', { name: /Needs attention/ }).click();
    await expect(row.locator('.session-row')).toHaveAttribute('aria-label', /Completed/);
    await expect(trash).toBeVisible(); await expect(trash).toBeDisabled();
    expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
