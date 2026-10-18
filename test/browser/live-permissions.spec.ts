import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

for (const entry of ['composer', 'palette']) test(`live permission change via ${entry} bypasses queued model work and leaves old approvals pending`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    const prompt = page.locator(visible('prompt'));
    await expect(page.locator(visible('model'))).toHaveText('small');
    await prompt.fill('live permission change fixture'); await prompt.press('Enter');
    const picker = page.locator('#command-palette');
    await expect(picker.locator('.acp-permission-command')).toHaveText('first fixture command');
    await page.keyboard.press('Escape'); await expect(picker).toBeHidden();
    const banner = page.locator('.session-view:not([hidden]) .notice-pending');
    await expect(banner).toContainText('1 request');
    // A separate idle-only configuration domain must not block permission policy.
    await page.locator(visible('model')).click();
    await page.locator('#palette-input').fill('Fixture large'); await page.locator('#palette-input').press('Enter');
    const model = page.locator(visible('messages')).locator('.message.configuration').filter({ hasText: 'Configuration change' });
    await expect(model.locator('.delivery-status-shimmer')).toHaveCount(1);
    await page.evaluate(() => {
      const host = window as unknown as { __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }; __releasePermissionChange?: () => void };
      const invoke = host.__TAURI_INTERNALS__.invoke;
      const gate = new Promise<void>(resolve => { host.__releasePermissionChange = resolve; });
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'write_copilot' && (args?.message as { method?: string })?.method === 'permission-change') await gate;
        return invoke(command, args);
      };
    });
    if (entry === 'composer') {
      await prompt.fill('/permissions allow-any'); await prompt.press('Escape'); await prompt.press('Enter');
      await expect(prompt).toHaveValue('');
      await prompt.fill('Keep newer draft');
    } else {
      await prompt.fill('Keep newer draft');
      await page.keyboard.press('Meta+Shift+P');
      await page.locator('#palette-input').fill('Select permissions'); await page.locator('#palette-input').press('Enter');
      await picker.getByRole('option').filter({ hasText: 'Allow all' }).click();
    }
    const row = page.locator(visible('messages')).locator('.message.configuration').filter({ hasText: 'Permission change' });
    await expect(row.locator('.delivery-status-shimmer')).toHaveText('Permission change');
    await expect(row).toHaveClass(/sticky-turn/);
    await row.evaluate(node => { node.setAttribute('data-fixture-identity', 'permission-policy'); });
    await page.evaluate(() => (window as unknown as { __releasePermissionChange: () => void }).__releasePermissionChange());
    await expect(row.locator('.delivery-status-shimmer')).toHaveCount(0);
    await expect(row).toHaveAttribute('data-operation-state', 'succeeded');
    await expect(row).toHaveAttribute('data-fixture-identity', 'permission-policy');
    await expect(row).not.toHaveClass(/sticky-turn/);
    await expect(model.locator('.delivery-status-shimmer')).toHaveCount(1);
    await expect(banner).toContainText('1 request');
    await expect(picker).toBeHidden();
    await expect(prompt).toHaveValue('Keep newer draft');
    expect(demo.calls.some(call => call.command === 'write_copilot' && ['configure', 'decision', 'cancel'].includes((call.args.message as { method: string }).method))).toBe(false);
    await banner.getByRole('button', { name: 'Review requests' }).click();
    await expect(picker.locator('.acp-permission-command')).toHaveText('first fixture command');
    await picker.getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Continued after live permission change');
    await expect(picker).toBeHidden(); await expect(banner).toBeHidden();
    await expect(prompt).toHaveValue('Keep newer draft');
    expect(demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'permission-change')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
