import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('session shortcut defaults open Switch, Resume and New named directly without disturbing the offline draft', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep this draft');
    const starts = demo.calls.filter(call => call.command === 'start_pi').length;
    await page.keyboard.press(primary + '+T'); await expect(page.locator('#palette-title')).toHaveText('Switch session');
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(1);
    expect(demo.calls.some(call => call.command === 'list_workspace_sessions')).toBe(false);
    await page.locator('#palette-input').press('Enter'); await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(prompt).toHaveValue('Keep this draft'); await expect(prompt).toBeFocused();
    await page.keyboard.press(primary + '+K'); await expect(page.locator('#palette-title')).toHaveText('Resume session');
    await expect.poll(() => demo.calls.filter(call => call.command === 'list_workspace_sessions').length).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await page.keyboard.press(primary + '+Alt+N'); await expect(page.locator('#palette-title')).toHaveText('New named session');
    await expect(page.locator('#palette-input')).toBeFocused();
    await page.locator('#palette-input').fill('Do not launch this fixture'); await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible(); await expect(prompt).toHaveValue('Keep this draft'); await expect(prompt).toBeFocused();
    await page.locator('#open-settings').click();
    await expect(page.locator('.keybinding-row[data-action="new"] button').filter({ hasText: /N$/ })).toHaveCount(1);
    await expect(page.locator('.keybinding-row[data-action="switch-session"] button').filter({ hasText: /T$/ })).toHaveCount(1);
    await expect(page.locator('.keybinding-row[data-action="switch-session"] button').filter({ hasText: /P$/ })).toHaveCount(0);
    expect(demo.calls.filter(call => call.command === 'start_pi')).toHaveLength(starts);
    expect(demo.calls.filter(call => call.command === 'preferences_settings')).toHaveLength(0);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('native-shaped Command-Option-N dead-key events open and record New named without modifying the offline draft', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }));
  const demo = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep this Option-key draft');
    const starts = demo.calls.filter(call => call.command === 'start_pi').length;
    // Playwright's keyboard.press sends key="n" here, unlike the Option-derived
    // key values reported by native macOS layouts. Exercise those shapes too.
    for (const key of ['Dead', '˜', 'ñ']) {
      const consumed = await prompt.evaluate((node, key) => {
        const event = new KeyboardEvent('keydown', { key, code: 'KeyN', metaKey: true, altKey: true, bubbles: true, cancelable: true });
        node.dispatchEvent(event); return event.defaultPrevented;
      }, key);
      expect(consumed).toBe(true);
      await expect(page.locator('#palette-title')).toHaveText('New named session');
      await expect(page.locator('#palette-input')).toBeFocused();
      await page.keyboard.press('Escape'); await expect(page.locator('#command-palette')).not.toBeVisible();
      await expect(prompt).toHaveValue('Keep this Option-key draft'); await expect(prompt).toBeFocused();
    }
    await page.locator('#open-settings').click();
    await page.locator('.keybinding-row[data-action="new-named"]').getByRole('button', { name: /^Change/ }).click();
    await page.locator('#keybinding-record').evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Dead', code: 'KeyN', metaKey: true, altKey: true, bubbles: true, cancelable: true })));
    await expect(page.locator('#keybinding-record')).toHaveValue('⌘+Option+N');
    await expect(page.locator('#keybinding-save')).toBeEnabled();
    await page.locator('#keybinding-cancel').click(); await page.locator('#settings-back').click();
    expect(demo.calls.filter(call => call.command === 'start_pi')).toHaveLength(starts);
    expect(demo.calls.filter(call => call.command === 'preferences_settings')).toHaveLength(0);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('keybinding recording, reassignment, unbinding and reset preserve the offline conversation', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Preserve this unsent draft');
    const tool = page.locator('.session-view:not([hidden]) .tool-card').first();
    await tool.locator('summary').first().click();
    const panel = await page.locator('.session-view').getAttribute('id');
    const starts = demo.calls.filter(call => call.command === 'start_pi').length;
    await page.locator('#open-settings').click();
    await page.locator('#keybinding-search').fill('effort');
    await expect(page.locator('#keybinding-list .keybinding-row')).toHaveCount(1);
    await expect(page.locator('#keybinding-list')).toContainText('Select thinking level');
    await page.locator('#keybinding-search').fill('');
    const sidebar = page.locator('.keybinding-row[data-action="sidebar"]');
    await sidebar.getByRole('button', { name: 'Add shortcut for Toggle session sidebar', exact: true }).click();
    await expect(page.locator('#keybinding-record')).toBeFocused();
    await page.keyboard.press(primary + '+J');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator('#keybinding-save')).toBeEnabled();
    await page.locator('#keybinding-save').click();
    await expect(page.locator('#keybinding-recorder')).not.toBeVisible();
    await expect(page.locator('#keybinding-search')).toBeFocused();
    await sidebar.getByRole('button', { name: /^Remove.*B$/ }).click();
    await expect(sidebar).toContainText('Modified');
    await expect(sidebar.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
    // Assign the sidebar's remaining shortcut to model, requiring explicit reassignment.
    const model = page.locator('.keybinding-row[data-action="model"]');
    await model.getByRole('button', { name: /^Change/ }).click();
    await page.keyboard.press(primary + '+J');
    await expect(page.locator('#keybinding-conflicts')).toContainText('Toggle session sidebar');
    await expect(page.locator('#keybinding-save')).toBeDisabled();
    await page.locator('#keybinding-reassign').check();
    await page.locator('#keybinding-save').click();
    await expect(page.locator('#keybinding-recorder')).not.toBeVisible();
    await expect(sidebar).toContainText('Unbound');
    await page.locator('#keybinding-reset-all').click();
    await expect(page.locator('#keybinding-recorder-title')).toHaveText('Reset all keybindings?');
    await page.keyboard.press('Escape');
    await expect(sidebar).toContainText('Unbound');
    await page.locator('#keybinding-reset-all').click();
    await page.locator('#keybinding-save').click();
    await expect(page.locator('#keybinding-recorder')).not.toBeVisible();
    await expect(sidebar).not.toContainText('Modified');
    await page.locator('#settings-back').click();
    await expect(page.locator('.session-view')).toHaveAttribute('id', panel!);
    await expect(prompt).toHaveValue('Preserve this unsent draft');
    await expect(tool).toHaveAttribute('open', '');
    await page.keyboard.press(primary + '+B');
    await expect(page.locator('#session-sidebar')).toBeHidden();
    await page.keyboard.press(primary + '+B');
    await expect(page.locator('#session-sidebar')).toBeVisible();
    expect(demo.calls.filter(call => call.command === 'start_pi')).toHaveLength(starts);
    expect(demo.children.size).toBe(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
