import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('sidebar pin and Close reveal on hover/focus; pin remains visible with retained row and conversation', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const row = page.locator('#open-sessions .open-session').first();
    const pin = row.locator('.session-pin'), close = row.locator('.session-close');
    await expect(row.locator('.session-delete')).toHaveCount(0);
    await pin.focus(); await expect(pin).toHaveCSS('opacity', '1'); await expect(close).toHaveCSS('opacity', '1');
    expect(await pin.evaluate(button => button.nextElementSibling?.className)).toBe('session-close');
    const separator = page.getByRole('separator', { name: 'Resize session sidebar' }); await separator.focus(); await separator.press('Home');
    await row.hover();
    const pinBox = (await pin.boundingBox())!, closeBox = (await close.boundingBox())!, rowBox = (await row.boundingBox())!;
    expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(closeBox.x);
    expect(Math.abs(pinBox.y - closeBox.y)).toBeLessThanOrEqual(1);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my draft');
    const panel = await page.locator('.session-view:not([hidden])').getAttribute('id');
    await row.hover(); await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await prompt.focus(); await prompt.hover();
    await expect(pin).toHaveCSS('opacity', '1'); await expect(close).toHaveCSS('opacity', '0');
    await expect(prompt).toHaveValue('Keep my draft');
    await expect(page.locator('.session-view:not([hidden])')).toHaveAttribute('id', panel!);
    await row.click({ button: 'right' });
    await expect.poll(() => demo.calls.filter(call => call.command === 'popup_session_menu').length).toBe(1);
    const options = demo.calls.find(call => call.command === 'popup_session_menu')!.args.options as Record<string, unknown>;
    expect(options.pinLabel).toBe('Unpin session'); expect(options.deleteEnabled).toBe(false);
    expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
