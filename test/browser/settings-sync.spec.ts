import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('file settings synchronize behind Settings without replacing the offline conversation or dirty Runtime fields', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1);
    await page.locator(visible('prompt')).fill('Keep this unsent draft');
    await page.locator('#open-settings').click();
    await page.locator('#settings-category-runtime').click();
    await page.locator('#pi-path').fill('/unsaved/pi');
    const retained = await page.locator(visible('transcript-viewport')).evaluate(pane => {
      (window as unknown as { retainedPane: Element }).retainedPane = pane;
      return pane.scrollTop;
    });
    await fixture.editPreferences('{"appearance.theme":"dracula","runtime.piPath":"/external/pi","runtime.nodePath":"/external/node"}');
    await expect(page.locator('#theme-picker')).toHaveValue('dracula');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
    await expect(page.locator('#pi-path')).toHaveValue('/unsaved/pi');
    await expect(page.locator('#runtime-status')).toContainText('unsaved edits are retained');
    await fixture.editPreferences('{broken}');
    await expect(page.locator('#preferences-error')).toBeVisible();
    await expect(page.locator('#theme-picker')).toHaveValue('dracula');
    await fixture.editPreferences('{"appearance.theme":"dracula","runtime.piPath":"/external/pi","runtime.nodePath":"/external/node"}');
    await expect(page.locator('#preferences-error')).toBeHidden();
    await page.locator('#settings-back').click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep this unsent draft');
    const current = await page.locator(visible('transcript-viewport')).evaluate(pane => ({
      same: (window as unknown as { retainedPane: Element }).retainedPane === pane,
      top: pane.scrollTop,
    }));
    expect(current.same).toBe(true); expect(Math.abs(current.top - retained)).toBeLessThanOrEqual(2);
    expect(fixture.calls.filter(call => call.command === 'start_pi')).toHaveLength(1);
    expect(fixture.calls.filter(call => call.command === 'stop_pi')).toHaveLength(1); // boot cleanup only
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
