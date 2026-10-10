import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('Open project reuses the picker, keeps its folder action through filtering and preserves the conversation', async ({ page }) => {
  const f = await demoFixture(page, { 'nimrod.workspaces.v1': ['/work/nimrod', '/other/nimrod'] });
  try {
    await page.locator(visible('prompt')).fill('Untouched draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('Open recent project');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Open recent project');
    const markers = page.locator('#palette-list .palette-selection-marker');
    await expect(markers).toHaveCount(3);
    expect(await markers.allTextContents()).toEqual(['•', '', '']);
    await expect(page.locator('#palette-list .palette-item-badge')).toHaveCount(0);
    const sizes = await markers.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, size: getComputedStyle(node).fontSize })));
    expect(sizes.every(size => size.width === sizes[0].width && size.size === sizes[0].size)).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+O');
    await expect(page.locator('#palette-title')).toHaveText('Open recent project');
    await page.locator('#palette-input').fill('/other');
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(1);
    await expect(page.locator('#palette-list small')).toHaveText('/other/nimrod');
    await page.locator('#palette-input').fill('no match');
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(0);
    await expect(page.locator('#palette-browse')).toBeVisible();
    await page.locator('#palette-browse').click();
    await expect(page.locator('#palette-input')).toHaveValue('no match');
    await expect(page.locator('#palette-input')).toBeFocused();
    const chooser = f.calls.find(c => c.command === 'plugin:dialog|open')!;
    expect(chooser.args.options).toMatchObject({ directory: true, multiple: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('prompt'))).toHaveValue('Untouched draft');
    expect(f.calls.filter(c => c.command === 'start_pi')).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
