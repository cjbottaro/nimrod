import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const width of [1440, 800, 480]) {
  test(`Settings has fluid content and scrolling side gutters at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 520 });
    const fixture = await demoFixture(page);
    try {
      await page.locator('#open-settings').click();
      const body = page.locator('.settings-content');
      const header = page.locator('.settings-header');
      const headerBounds = await header.boundingBox();
      const bounds = await body.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBe(0);
      expect(bounds!.width).toBe(width);
      const geometry = await body.evaluate(element => ({
        left: getComputedStyle(element).paddingLeft,
        right: getComputedStyle(element).paddingRight,
        client: element.clientWidth, scroll: element.scrollWidth,
        overflows: element.scrollHeight > element.clientHeight,
      }));
      expect(geometry.left).toBe('20px');
      expect(geometry.right).toBe('20px');
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
      expect(geometry.overflows).toBe(true);
      for (const x of [8, width - 8]) {
        await body.evaluate(element => { element.scrollTop = 0; });
        await page.mouse.move(x, bounds!.y + 80);
        await page.mouse.wheel(0, 240);
        await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect(await header.boundingBox()).toEqual(headerBounds);
      }
      await page.locator('#settings-back').click();
      await expect(page.locator('#settings-page')).not.toBeVisible();
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}
