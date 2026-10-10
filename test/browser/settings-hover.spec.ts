import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('Settings category hover leaves selected styling unchanged and highlights only unselected categories', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click();
    const appearance = page.locator('#settings-category-appearance');
    const runtime = page.locator('#settings-category-runtime');
    const colors = (tab: typeof appearance) => tab.evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, foreground: style.color };
    });
    await page.locator('#settings-title').hover();
    const selected = await colors(appearance), unselected = await colors(runtime);
    await appearance.hover();
    expect(await colors(appearance)).toEqual(selected);
    await runtime.hover();
    expect((await colors(runtime)).background).not.toBe(unselected.background);
    await expect(runtime).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#settings-panel-appearance')).toBeVisible();
    await runtime.click();
    expect(await colors(runtime)).toEqual(selected);
    await page.locator('#settings-title').hover();
    expect(await colors(runtime)).toEqual(selected);
    const inactive = await colors(appearance);
    await appearance.hover();
    expect((await colors(appearance)).background).not.toBe(inactive.background);
    await runtime.hover();
    expect(await colors(runtime)).toEqual(selected);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
