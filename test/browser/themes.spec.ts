import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('offline bundled VS Code themes preview by keyboard/hover and persist without changing the conversation', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep theme preview draft');
    await page.locator(visible('messages')).evaluate(node => (node as HTMLElement).dataset.identity = 'retained');
    const initial = await page.locator('html').getAttribute('data-theme');
    const starts = demo.calls.filter(call => call.command === 'start_pi').length;
    const open = async () => {
      await page.keyboard.press(primary + '+Shift+P');
      await page.locator('#palette-input').fill('Select theme');
      await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#palette-title')).toHaveText('Select theme');
      await expect(page.locator('#palette-list')).toContainText('Nord');
      await expect(page.locator('#palette-refresh')).not.toBeVisible();
    };
    await open();
    const alignment = await page.locator('#palette-list [aria-current=true]').evaluate(row => {
      const label = row.querySelector('.palette-item-label')!.getBoundingClientRect();
      const dot = row.querySelector('.palette-selection-marker')!.getBoundingClientRect();
      const detail = row.querySelector('.palette-item-description')!.getBoundingClientRect();
      return { titleOffset: label.left - detail.left, dotGap: dot.left - label.right };
    });
    expect(Math.abs(alignment.titleOffset)).toBeLessThan(1);
    expect(alignment.dotGap).toBeGreaterThan(0); expect(alignment.dotGap).toBeLessThan(12);
    await page.locator('#palette-input').fill('Night Owl');
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
    await page.locator('#palette-input').press('ArrowDown');
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
    await page.locator('#palette-list .palette-item-label').getByText('Night Owl', { exact: true }).hover();
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
    expect(demo.calls.filter(call => call.command === 'preferences_settings')).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', initial!);
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Keep theme preview draft');
    await open(); await page.locator('#palette-input').fill('Nord');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catalog-nord-vscode-nord');
    await expect.poll(() => demo.calls.filter(call => call.command === 'preferences_settings').length).toBe(1);
    await open(); await page.locator('#palette-input').fill('Nimrod');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'nimrod');
    await page.locator('#palette-back').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catalog-nord-vscode-nord');
    await page.keyboard.press('Escape');
    await expect(page.locator(visible('messages'))).toHaveAttribute('data-identity', 'retained');
    await expect(prompt).toHaveValue('Keep theme preview draft');
    expect(demo.calls.filter(call => call.command === 'fetch_gogh_catalog')).toHaveLength(0);
    expect(demo.calls.filter(call => call.command === 'start_pi')).toHaveLength(starts);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
