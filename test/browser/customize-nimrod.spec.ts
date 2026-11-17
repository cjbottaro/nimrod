import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('Customize Nimrod previews installed guidance, preserves the draft and sends one disclosed ordinary user turn', async ({ page }) => {
  const f = await demoFixture(page);
  try {
    await page.locator('#sidebar-new').click();
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep this Composer draft');
    await prompt.evaluate(input => { (window as unknown as { retainedPrompt: Element }).retainedPrompt = input; });
    const open = async () => {
      await page.keyboard.press('ControlOrMeta+Shift+P');
      await page.locator('#palette-input').fill('Customize Nimrod');
      await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#customize-nimrod')).toBeVisible();
      await expect(page.locator('#customize-nimrod-status')).toHaveText('');
    };
    await open();
    const input = page.locator('#customize-nimrod-input');
    await expect(input).toBeFocused();
    await page.locator('#customize-nimrod-instructions > summary').click();
    await expect(page.locator('#customize-nimrod-instructions > pre')).toContainText('/fixture installed app/resources/customization/docs/ui-templates.md');
    const before = f.calls.filter(call => call.command === 'write_pi' && (call.args.message as { type?: string }).type === 'prompt').length;
    await input.fill('Cancel this request'); await page.keyboard.press('Escape');
    await expect(page.locator('#customize-nimrod')).not.toBeVisible();
    expect(f.calls.filter(call => call.command === 'write_pi' && (call.args.message as { type?: string }).type === 'prompt').length).toBe(before);
    await expect(prompt).toHaveValue('Keep this Composer draft');
    await open(); await input.fill('Make the Project bar compact.');
    await input.press('Enter');
    await expect(page.locator('#customize-nimrod')).not.toBeVisible();
    await expect(prompt).toHaveValue('Keep this Composer draft'); await expect(prompt).toBeFocused();
    expect(await prompt.evaluate(input => input === (window as unknown as { retainedPrompt: Element }).retainedPrompt)).toBe(true);
    const card = page.locator('.session-view:not([hidden]) .customization-request');
    await expect(card).toContainText('Make the Project bar compact.');
    await expect(card.locator('details')).not.toHaveAttribute('open', '');
    await card.locator('summary').click();
    await expect(card.locator('.skill-body')).toContainText('Do not look for a Nimrod checkout');
    expect(f.calls.filter(call => call.command === 'write_pi' && (call.args.message as { type?: string }).type === 'prompt').length).toBe(before + 1);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
