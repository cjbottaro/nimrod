import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const global of [false, true]) test(`Runtime auto-saves only edited fields (${global ? 'global' : 'project'})`, async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const settings = global ? await fixture.settingsWindow() : page;
    if (!global) await settings.locator('#open-settings').click();
    await settings.locator('#settings-category-runtime').click();
    await expect(settings.locator('#save-runtime')).toHaveCount(0);
    await settings.locator('#pi-path').fill('/edited/pi');
    const command = global ? 'preferences_settings' : 'project_preferences_settings';
    const writes = () => fixture.calls.filter(call => call.command === command);
    const before = writes().length;
    await settings.locator('#pi-path').press('Tab');
    await expect.poll(() => writes().length).toBe(before + 1);
    await expect(settings.locator('#runtime-status')).toContainText('Saved.');
    const persisted = JSON.parse(String(writes().at(-1)!.args.text));
    expect(persisted['runtime.piPath']).toBe('/edited/pi');
    for (const key of ['runtime.nodePath', 'runtime.copilotPath', 'runtime.codexPath']) expect(persisted[key]).toBeUndefined();
    await settings.locator('#node-path').fill(''); // Independent invalid/unfinished draft.
    await settings.locator('#codex-path').fill('/edited/codex');
    await settings.locator('#codex-path').press('Enter');
    await expect.poll(() => writes().length).toBe(before + 2);
    await expect(settings.locator('#node-path')).toHaveValue('');
    await expect(settings.locator('#application-notices')).toContainText('non-empty');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
