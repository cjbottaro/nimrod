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
        if (command === 'write_copilot' && ['permission-change', 'command'].includes(String((args?.message as { method?: string })?.method))) await gate;
        return invoke(command, args);
      };
    });
    if (entry === 'composer') {
      await prompt.fill('/permissions allow-all'); await prompt.press('Escape'); await prompt.press('Enter');
      await expect(prompt).toHaveValue('');
      await prompt.fill('Keep newer draft');
    } else {
      await prompt.fill('Keep newer draft');
      await page.keyboard.press('Meta+Shift+P');
      await page.locator('#palette-input').fill('Set permissions'); await page.locator('#palette-input').press('Enter');
      await picker.getByRole('option').filter({ hasText: 'Allow all' }).click();
    }
    const title = entry === 'composer' ? 'Copilot command' : 'Permission change';
    const row = page.locator(visible('messages')).locator('.message.configuration').filter({ hasText: title });
    await expect(row.locator('.delivery-status-shimmer')).toHaveText(title);
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
    const expectedMethod = entry === 'composer' ? 'command' : 'permission-change';
    expect(demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === expectedMethod)).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('screenshot regression: /permissions allow-all submits during streaming instead of hitting the idle-only guard', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('small');
    const prompt = page.locator(visible('prompt'));
    for (const text of ['First fixture turn', 'Second fixture turn']) {
      await prompt.fill(text); await prompt.press('Enter');
      await page.locator('#command-palette').getByRole('option', { name: 'Allow once', exact: true }).click();
      if (text.startsWith('First')) await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    }
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Stop Copilot');
    await prompt.fill('/permissions allow-all'); await prompt.press('Escape'); await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    const row = page.locator(visible('messages')).locator('.message.configuration').filter({ hasText: 'Copilot command' });
    await expect(row).toHaveAttribute('data-operation-state', 'succeeded');
    await expect(page.locator(visible('session-notices'))).not.toContainText('Copilot is not idle');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Stop Copilot');
    const requests = demo.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as { method: string; value?: string; input?: string });
    expect(requests.filter(request => request.method === 'command').map(request => request.input)).toEqual(['allow-all']);
    expect(requests.filter(request => request.method === 'prompt')).toHaveLength(2);
    expect(requests.some(request => request.method === 'cancel')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
