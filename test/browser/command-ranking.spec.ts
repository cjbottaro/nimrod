import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { COMMAND_USAGE_KEY } from '../../src/command-ranking';

test('palette uses saved MRU, records picker entry and preserves draft and native close focus', async ({ page }) => {
  const demo = await demoFixture(page, { [COMMAND_USAGE_KEY]: { version: 1, entries: [
    { id: 'resume', lastUsedAt: 1, useCount: 1 },
  ] } });
  try {
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Retain ranking draft');
    await page.keyboard.press(primary + '+Shift+P');
    const rows = page.locator('#palette-list [role=option]');
    await expect(rows.first()).toContainText('Resume session');
    await page.locator('#palette-input').fill('switch session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Switch session');
    await expect.poll(() => demo.calls.filter(c => c.command === 'record_command_usage').length).toBe(1);
    await page.keyboard.press('Escape'); await expect(prompt).toBeFocused();
    await page.keyboard.press(primary + '+Shift+P');
    await expect(rows.first()).toContainText('Switch session');
    await page.locator('#palette-input').fill('resume');
    await expect(rows).toHaveCount(1); await expect(rows.first()).toContainText('Resume session');
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveValue('Retain ranking draft'); await expect(prompt).toBeFocused();
    expect(demo.calls.filter(c => c.command === 'record_command_usage')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
