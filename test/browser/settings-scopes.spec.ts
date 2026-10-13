import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

// Real offline WebKit pages; singleton routing/native ownership still needs native acceptance.
test('project provenance and global defaults reconcile across independent Settings and project pages', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my draft');
    const starts = fixture.calls.filter(call => call.command === 'start_pi').length;
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-title')).toContainText('Project settings');
    await expect(page.locator('#settings-category-notifications')).toBeHidden();
    await expect(page.locator('#settings-category-keybindings')).toBeHidden();
    await expect(page.locator('#theme-picker-source')).toHaveText('Global default');
    await page.locator('#theme-picker').selectOption('dracula');
    await expect(page.locator('#theme-picker-source')).toHaveText('Project override');
    expect(fixture.calls.filter(call => call.command === 'preferences_settings')).toHaveLength(0);
    const settingsPage = await fixture.settingsWindow();
    await expect(settingsPage.locator('#settings-title')).toHaveText('Settings');
    await expect(settingsPage.locator('#workspace-layout')).toBeHidden();
    await expect(settingsPage.locator('#theme-picker')).toHaveValue('nimrod');
    await expect(settingsPage.locator('.settings-project-links')).toContainText('Theme');
    await settingsPage.locator('#theme-picker').selectOption('tokyo-night');
    await expect(page.locator('#theme-picker')).toHaveValue('dracula');
    await page.bringToFront();
    await page.getByRole('button', { name: 'Use global default for Color theme', exact: true }).click();
    await expect(page.locator('#theme-picker')).toHaveValue('tokyo-night');
    await expect(page.locator('#theme-picker-source')).toHaveText('Global default');
    await expect(settingsPage.locator('.settings-project-links')).toHaveText('No open project has overrides.');
    await fixture.editPreferences('{"appearance.theme":"osaka-jade"}');
    await expect(page.locator('#theme-picker')).toHaveValue('osaka-jade');
    await page.locator('#settings-back').click();
    await expect(prompt).toHaveValue('Keep my draft');
    expect(fixture.calls.filter(call => call.command === 'start_pi')).toHaveLength(starts);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
