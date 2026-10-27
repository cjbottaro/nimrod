import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

// Offline layout coverage only; not native appearance/platform acceptance.
for (const width of [1440, 800, 480]) {
  test(`grouped Settings controls fit and retain help state at ${width}px`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      const settings = await fixture.settingsWindow();
      await settings.setViewportSize({ width, height: 760 });
      const appearance = settings.locator('#settings-panel-appearance');
      await expect(appearance).toBeVisible();
      expect(await settings.locator('.settings-header').evaluate(node => (node as HTMLElement).offsetHeight)).toBe(48);
      expect(await settings.locator('#card-plugin-status').evaluate(node => getComputedStyle(node).display)).toBe('none');
      await expect(settings.locator('#settings-translucency > details')).not.toHaveAttribute('open', '');
      await settings.locator('#settings-translucency summary').click();
      await expect(settings.locator('#translucency-hint')).toBeVisible();
      expect(await settings.locator('#background-opacity').evaluate(node => {
        const row = node.closest('.settings-row')!;
        return row.contains(row.querySelector('label[for="background-opacity"]')) && row.contains(node.nextElementSibling);
      })).toBe(true);
      const group = await settings.locator('#settings-typography > .settings-group').boundingBox();
      const pane = await appearance.boundingBox();
      expect(group!.width).toBeLessThanOrEqual(pane!.width);
      await expect(settings.getByLabel('Size (px)', { exact: true }).first()).toHaveAttribute('type', 'number');
      for (const category of ['interaction', 'notifications', 'diagnostics', 'keybindings', 'runtime', 'appearance']) {
        await settings.locator(`#settings-category-${category}`).click();
        const panel = settings.locator(category === 'keybindings' ? '#keybindings-section' : `#settings-panel-${category}`);
        await expect(panel).toBeVisible();
        expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), category).toBe(true);
      }
      await expect(settings.locator('#settings-translucency > details')).toHaveAttribute('open', '');
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('project provenance stays with its compact field and global-only groups stay hidden', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click();
    await expect(page.locator('#theme-hint')).toContainText('this project');
    await expect(page.locator('#theme-picker').locator('..').locator('.settings-source')).toContainText('Global default');
    for (const id of ['settings-translucency', 'settings-typography', 'settings-zoom', 'settings-modal-animation', 'settings-send-auto-follow']) {
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await page.locator('#settings-category-runtime').click();
    await expect(page.locator('#pi-path').locator('..').locator('.settings-source')).toContainText('Global default');
    await page.locator('#pi-path').fill('/unsaved/pi');
    await page.locator('#settings-category-appearance').click();
    await page.locator('#settings-category-runtime').click();
    await expect(page.locator('#pi-path')).toHaveValue('/unsaved/pi');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
