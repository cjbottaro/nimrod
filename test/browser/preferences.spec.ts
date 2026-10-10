import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('fresh offline session model and effort controls share the searchable palette', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep unsent');
    await page.locator(visible('model')).click();
    await expect(page.locator('#palette-title')).toHaveText('Select model');
    await expect(page.locator('#palette-list')).toContainText('fixture/offline-demo');
    await expect(page.locator('#palette-list [aria-current=true] .palette-selection-marker')).toHaveText('•');
    await expect(page.locator('#palette-list .session-indicator, #palette-list small')).toHaveCount(0);
    await expect(page.locator('#palette-list')).not.toContainText('Current');
    await expect(page.locator('#host-dialog')).not.toBeVisible();
    await page.locator('#palette-input').fill('offline');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('model'))).toBeEnabled();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('effort');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Select thinking level');
    const rows = page.locator('#palette-list [role=option]');
    const current = page.locator('#palette-list [aria-current=true]');
    await expect(current.locator('.palette-selection-marker')).toHaveText('•');
    await expect(current.locator('.palette-item-label')).toHaveText('medium');
    await expect(rows.locator('.palette-selection-marker')).toHaveText(['', '', '•', '']);
    await expect(page.locator('#palette-list .session-indicator, #palette-list small')).toHaveCount(0);
    const geometry = await rows.evaluateAll(options => options.map(option => {
      const marker = option.querySelector('.palette-selection-marker')!;
      return { label: option.querySelector('.palette-item-label')!.getBoundingClientRect().left,
        slot: marker.getBoundingClientRect().width, size: parseFloat(getComputedStyle(marker).fontSize) };
    }));
    expect(new Set(geometry.map(option => option.label)).size).toBe(1);
    expect(new Set(geometry.map(option => option.slot)).size).toBe(1);
    const separatorSize = await page.locator('.session-view:not([hidden]) .status-separator').evaluate(dot => parseFloat(getComputedStyle(dot).fontSize));
    expect(geometry[0].size).toBeGreaterThan(separatorSize);
    await page.locator('#palette-input').press('ArrowDown');
    await expect(rows.nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(current).toHaveAttribute('aria-selected', 'false');
    await expect(current.locator('.palette-selection-marker')).toHaveText('•');
    const background = (index: number) => rows.nth(index).evaluate(row => getComputedStyle(row).backgroundColor);
    await rows.nth(0).hover();
    expect(await background(0)).not.toBe(await background(2));
    expect(await background(3)).not.toBe(await background(2));
    await expect(rows.locator('.palette-selection-marker')).toHaveText(['', '', '•', '']);
    await page.locator('#palette-input').fill('high');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('thinking'))).toHaveText('high');
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep unsent');
    expect(demo.calls.some(c => (c.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
