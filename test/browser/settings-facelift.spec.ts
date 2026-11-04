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

for (const width of [1440, 800, 480]) {
  test(`project scope and Settings files stay compact at ${width}px`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await page.setViewportSize({ width, height: 760 });
      await page.locator('#open-settings').click();
      await expect(page.locator('#settings-scope-description')).toContainText('override Global Settings');
      await expect(page.locator('#settings-project-inheritance')).toContainText('Inherited values');
      await expect(page.locator('#card-plugin-status')).toBeHidden();
      await page.locator('#settings-category-runtime').click();
      await page.locator('.settings-runtime-files summary').click();
      await expect(page.locator('#settings-project-file')).toBeVisible();
      await expect(page.locator('#project-settings-file-path')).toHaveText('.nimrod/settings.json');
      await expect(page.locator('#settings-state-file')).toBeHidden();
      await expect(page.locator('#settings-file-path')).not.toBeEmpty();
      const calls = fixture.calls.length;
      await page.locator('#copy-project-settings-path').click();
      await expect(page.locator('#settings-file-copy-status')).toHaveText('Copied project settings path.');
      expect(fixture.calls.slice(calls).filter(call => call.command === 'plugin:clipboard-manager|write_text')).toHaveLength(1);
      const panel = page.locator('#settings-panel-runtime');
      expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect(await page.locator('.settings-header').evaluate(node => (node as HTMLElement).offsetHeight)).toBe(48);
      await page.locator('#settings-category-appearance').click();
      await page.locator('#settings-category-runtime').click();
      await expect(page.locator('.settings-runtime-files')).toHaveAttribute('open', '');
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

for (const width of [1440, 800, 480]) {
  test(`theme name, provenance and action stay grouped at ${width}px`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await page.setViewportSize({ width, height: 760 });
      await page.locator('#open-settings').click();
      await expect(page.locator('#settings-scope-description')).toContainText('this project directory');
      await expect(page.locator('#theme-hint')).toBeHidden();
      await expect(page.locator('.theme-setting-value .settings-source')).toContainText('Inherited');
      const layout = await page.locator('.theme-setting-controls').evaluate(element => {
        const value = element.querySelector<HTMLElement>('.theme-setting-value')!;
        const button = element.querySelector<HTMLElement>('#theme-picker')!;
        const name = value.querySelector<HTMLElement>('#theme-current')!;
        const source = value.querySelector<HTMLElement>('.settings-source')!;
        const field = element.getBoundingClientRect(), v = value.getBoundingClientRect(), b = button.getBoundingClientRect();
        return { fits: field.width >= 140 + b.width + 12, inline: Math.abs(v.top - b.top) <= 1 && v.right <= b.left,
          wrapped: b.top >= v.bottom, sourceBelow: source.getBoundingClientRect().top >= name.getBoundingClientRect().bottom,
          overflow: element.scrollWidth > element.clientWidth + 1 };
      });
      expect(layout.fits ? layout.inline : layout.wrapped).toBe(true);
      expect(layout.sourceBelow).toBe(true);
      expect(layout.overflow).toBe(false);
      await page.locator('#theme-current').evaluate(node => { node.textContent = 'An imported theme with a deliberately very long name for narrow settings panes'; });
      expect(await page.locator('#settings-panel-appearance').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.locator('#theme-picker').click();
      await page.locator('#palette-input').press('Escape');
      await expect(page.locator('#settings-page')).toBeVisible();
      await expect(page.locator('#theme-picker')).toBeFocused();
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('project provenance stays with its compact field and global-only groups stay hidden', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click();
    await expect(page.locator('#theme-hint')).toBeHidden();
    await expect(page.locator('.theme-setting-value .settings-source')).toContainText('Inherited');
    for (const id of ['settings-translucency', 'settings-typography', 'settings-zoom', 'settings-modal-animation', 'settings-send-auto-follow']) {
      await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await page.locator('#settings-category-runtime').click();
    await expect(page.locator('#pi-path').locator('..').locator('.settings-source')).toHaveCount(0);
    await expect(page.locator('#pi-path')).toHaveValue('');
    await expect(page.locator('#pi-path')).toHaveAttribute('placeholder', /.+/);
    await expect(page.locator('#runtime-inheritance-hint')).toContainText('Leave blank');
    await page.locator('#pi-path').fill('/unsaved/pi');
    await page.locator('#settings-category-appearance').click();
    await page.locator('#settings-category-runtime').click();
    await expect(page.locator('#pi-path')).toHaveValue('/unsaved/pi');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
