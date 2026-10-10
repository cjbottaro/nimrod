import { expect, test, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const widthKey = 'nimrod.settings.sidebar.width';
const sessionKey = `nimrod.sidebar.width:${process.cwd()}`;
const sidebarWidth = (page: Page) => page.locator('#settings-sidebar').evaluate(node => (node as HTMLElement).offsetWidth);
async function drag(page: Page, delta: number, release = true) {
  const bounds = (await page.locator('#settings-resizer').boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + 60;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + delta, y, { steps: 6 });
  if (release) await page.mouse.up();
}

for (const width of [1440, 800, 480]) {
  test(`Settings categories have fluid panes and scrolling gutters at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 520 });
    const fixture = await demoFixture(page);
    try {
      await page.locator('#open-settings').click();
      await expect(page.locator('#settings-panel-appearance')).toBeVisible();
      await expect(page.locator('#settings-panel-runtime')).toBeHidden();
      await page.locator('#settings-category-keybindings').click();
      const body = page.locator('#keybindings-section');
      const headerBounds = await page.locator('.settings-header').boundingBox();
      const sidebarBounds = (await page.locator('#settings-sidebar').boundingBox())!;
      const bounds = (await body.boundingBox())!;
      expect(Math.abs(bounds.x - sidebarBounds.x - sidebarBounds.width)).toBeLessThanOrEqual(1);
      const pageBounds = (await page.locator('#settings-page').boundingBox())!;
      expect(Math.abs(bounds.x + bounds.width - pageBounds.width)).toBeLessThanOrEqual(1);
      expect(await page.locator('#settings-page').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const geometry = await body.evaluate(element => ({
        left: getComputedStyle(element).paddingLeft, right: getComputedStyle(element).paddingRight,
        client: element.clientWidth, scroll: element.scrollWidth, overflows: element.scrollHeight > element.clientHeight,
      }));
      expect(geometry.left).toBe('20px'); expect(geometry.right).toBe('20px');
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client); expect(geometry.overflows).toBe(true);
      for (const x of [bounds.x + 8, bounds.x + bounds.width - 8]) {
        await body.evaluate(element => { element.scrollTop = 0; });
        await page.mouse.move(x, bounds.y + 80); await page.mouse.wheel(0, 240);
        await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect(await page.locator('.settings-header').boundingBox()).toEqual(headerBounds);
        expect(await page.locator('#settings-sidebar').boundingBox()).toEqual(sidebarBounds);
      }
      const scroll = await body.evaluate(node => node.scrollTop);
      await page.locator('#settings-category-runtime').click(); await page.locator('#pi-path').fill('/unsaved/pi');
      await page.locator('#settings-category-keybindings').click();
      expect(await body.evaluate(node => node.scrollTop)).toBe(scroll);
      await page.locator('#keybinding-search').fill('effort');
      await page.locator('#settings-category-runtime').click(); await expect(page.locator('#pi-path')).toHaveValue('/unsaved/pi');
      await page.locator('#settings-back').click(); await page.locator('#open-settings').click();
      await expect(page.locator('#settings-panel-runtime')).toBeVisible();
      await page.locator('#settings-category-keybindings').click(); await expect(page.locator('#keybinding-search')).toHaveValue('effort');
      await page.locator('#settings-category-keybindings').focus(); await page.keyboard.press('Home');
      await expect(page.locator('#settings-category-appearance')).toBeFocused();
      await page.keyboard.press('ArrowUp'); await expect(page.locator('#settings-panel-runtime')).toBeVisible();
      await page.keyboard.press('Escape'); await expect(page.locator('#settings-page')).not.toBeVisible();
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('Settings shares zoom-aware resize mechanics with independent persisted width and modal cancellation', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const fixture = await demoFixture(page, { [sessionKey]: 340, [widthKey]: 220 });
  try {
    await fixture.turn(1); await page.locator(visible('prompt')).fill('Keep my draft');
    const panel = await page.locator('.session-view').getAttribute('id');
    await page.locator('#open-settings').click(); await page.locator('#settings-category-runtime').click();
    await page.locator('#pi-path').fill('/dirty/pi');
    await drag(page, 100); // fixture zoom 125%: 100 physical pixels = 80 layout pixels
    await expect.poll(() => sidebarWidth(page)).toBe(300);
    await expect.poll(() => fixture.state()[widthKey]).toBe(300);
    await expect(page.locator('#pi-path')).toBeFocused(); await expect(page.locator('#pi-path')).toHaveValue('/dirty/pi');
    expect(fixture.state()[sessionKey]).toBe(340);
    await drag(page, -75, false); await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('#settings-page')).toBeVisible(); await expect.poll(() => sidebarWidth(page)).toBe(300);
    expect(fixture.state()[widthKey]).toBe(300);
    await page.setViewportSize({ width: 480, height: 700 }); await expect.poll(() => sidebarWidth(page)).toBeLessThan(300);
    expect(fixture.state()[widthKey]).toBe(300);
    await page.setViewportSize({ width: 1200, height: 800 }); await expect.poll(() => sidebarWidth(page)).toBe(300);
    const handle = page.locator('#settings-resizer');
    await handle.focus(); await handle.press('ArrowRight'); await expect.poll(() => fixture.state()[widthKey]).toBe(310);
    await handle.press('Shift+ArrowLeft'); await expect.poll(() => fixture.state()[widthKey]).toBe(260);
    await handle.press('Home'); await expect.poll(() => sidebarWidth(page)).toBe(160);
    await handle.press('End'); await expect.poll(() => sidebarWidth(page)).toBe(360);
    await handle.dblclick(); await expect.poll(() => fixture.state()[widthKey]).toBe(null); await expect.poll(() => sidebarWidth(page)).toBe(220);
    await page.locator('#settings-category-keybindings').click();
    await page.locator('.keybinding-row[data-action="sidebar"]').getByRole('button', { name: /^Add/ }).click();
    await handle.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(fixture.state()[widthKey]).toBe(null);
    await page.keyboard.press('Escape'); await expect(page.locator('#settings-page')).toBeVisible();
    await handle.focus(); await handle.press('ArrowRight'); await expect.poll(() => fixture.state()[widthKey]).toBe(230);
    const reopened = await context.newPage(); await reopened.setViewportSize({ width: 1200, height: 800 });
    const restored = await demoFixture(reopened, fixture.state());
    try {
      await reopened.locator('#open-settings').click(); await expect.poll(() => sidebarWidth(reopened)).toBe(230);
      await expect.poll(() => reopened.locator('#session-sidebar').evaluate(node => (node as HTMLElement).offsetWidth)).toBe(340);
      expect(restored.errors).toEqual([]);
    } finally { await restored.close(); await reopened.close(); }
    await page.locator('#settings-back').click(); await expect(page.locator(visible('prompt'))).toHaveValue('Keep my draft');
    expect(await page.locator('.session-view').getAttribute('id')).toBe(panel);
    expect(fixture.children.size).toBe(1); expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
