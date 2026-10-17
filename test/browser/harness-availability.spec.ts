import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('retired ACP sessions and actions stay absent; Copilot uses concise labels', async ({ page }) => {
  const project = process.cwd();
  const demo = await demoFixture(page, {
    [`nimrod.tabs.v1:${project}`]: { tabs: [
      { kind: 'acp', profile: 'copilot', sessionId: 'fixture-acp', name: 'Retired ACP session' },
      { kind: 'copilot-sdk', sessionId: 'fixture-sdk', name: 'Current Copilot' },
    ] },
    [`nimrod.history.copilot.v1:${project}`]: true,
  });
  try {
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    await expect(page.locator('#open-sessions')).not.toContainText('ACP');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('ACP');
    await expect(page.locator('#palette-list [role="option"]')).toHaveCount(0);
    await page.locator('#palette-input').fill('New Copilot session');
    await expect(page.locator('#palette-list')).toContainText('Start a Copilot session');
    await expect(page.locator('#palette-list')).not.toContainText('installed and authenticated');
    await page.keyboard.press('Escape');
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Current Copilot' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator('#mode-badge')).toHaveText('Copilot');
    expect(demo.calls.some(call => call.command === 'start_acp')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
