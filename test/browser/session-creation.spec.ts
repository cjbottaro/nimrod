import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('named Copilot creation uses native naming without sending a prompt', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Alt+N');
    await expect(page.locator('#palette-title')).toHaveText('New named session');
    await page.locator('#palette-input').fill('Named offline Copilot');
    await page.locator('#palette-list [data-key="copilot-sdk"]').click();
    await expect(page.locator('#palette-input')).toHaveValue('Named offline Copilot');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator('#mode-badge')).toHaveText('Copilot');
    await expect(page.locator('#project-session-name')).toHaveText('Named offline Copilot');
    await expect(page.locator(visible('send'))).toBeEnabled();
    const writes = demo.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as { method?: string; name?: string });
    expect(writes.filter(message => message.method === 'rename')).toEqual([expect.objectContaining({ name: 'Named offline Copilot' })]);
    expect(writes.some(message => message.method === 'prompt' || message.method === 'command')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('named creation combines name and eligible harness in one shared modal and Cancel preserves the current draft', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep the original draft');
    const rows = await page.locator('#open-sessions .session-row').count();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-list [data-key="new-named"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('#palette-input')).toBeFocused();
    const harnesses = page.getByRole('listbox', { name: 'Harness', exact: true });
    await expect(harnesses).toBeVisible();
    await expect(harnesses.locator('.palette-item-label')).toHaveText(['Pi', 'Copilot']);
    await expect(page.locator('#command-palette select')).toHaveCount(0);
    await page.locator('#palette-input').fill('Do not create');
    await page.locator('#palette-input').press('ArrowDown');
    await expect(page.locator('#palette-input')).toBeFocused();
    await expect(harnesses.locator('[aria-selected="true"] .palette-item-label')).toHaveText('Copilot');
    await expect(harnesses.locator('[aria-selected="true"] .palette-selection-marker')).toHaveText('•');
    await expect(page.locator('#palette-input')).toHaveValue('Do not create');
    await page.keyboard.press('Tab'); await expect(harnesses).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#palette-input')).toHaveValue('Do not create');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(rows);
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep the original draft');
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-list [data-key="new-with-harness"]').click();
    await expect(page.locator('#palette-list [data-key="pi"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#palette-list')).toContainText('Copilot');
    await expect(page.locator('#palette-list')).not.toContainText('Codex');
    await expect(page.locator('#palette-list [data-key="pi"] .palette-selection-marker')).toHaveText('•');
    await page.locator('#palette-input').press('ArrowDown');
    await expect(page.locator('#palette-list [data-key="copilot-sdk"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#palette-list [data-key="copilot-sdk"] .palette-selection-marker')).toHaveText('•');
    await expect(page.locator('#palette-list [data-key="pi"] .palette-selection-marker')).toHaveText('');
    await page.locator('#palette-list [data-key="pi"]').hover();
    await expect(page.locator('#palette-list [data-key="pi"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#palette-list [data-key="pi"] .palette-selection-marker')).toHaveText('•');
    await expect(page.locator('#palette-list [data-key="copilot-sdk"] .palette-selection-marker')).toHaveText('');
    await expect(page.locator('#palette-list [aria-current]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(rows);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
