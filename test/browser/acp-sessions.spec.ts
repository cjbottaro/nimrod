import { expect, test, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

async function newAcp(page: Page) {
  await page.keyboard.press('Meta+Shift+P');
  await page.locator('#palette-input').fill('New ACP session');
  await page.locator('#palette-input').press('Enter');
  await expect(page.locator('#palette-title')).toHaveText('New ACP session (POC)');
  await page.locator('#palette-input').press('Enter');
  await expect(page.locator('#mode-badge')).toHaveText(/Copilot.*ACP/);
  await expect(page.locator(visible('send'))).toBeEnabled();
  return page.locator('.session-view:not([hidden])').getAttribute('id');
}

test('offline ACP and Pi keep independent drafts, permissions, configuration and shutdown', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const piId = await page.locator('.session-view').getAttribute('id');
    await page.locator(visible('prompt')).fill('Pi draft must survive');
    const acpId = await newAcp(page);
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    await page.locator(visible('prompt')).fill('Offline ACP request');
    await page.locator(visible('prompt')).press('Enter');
    const permission = page.locator(`#${acpId} .acp-permission`);
    await expect(permission).toBeVisible();
    await expect(page.locator(`#${acpId} .message.user`)).toHaveCount(1);
    await page.locator(`#open-sessions .session-row[aria-controls="${piId}"]`).click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Pi draft must survive');
    await expect(permission).toBeHidden();
    expect(demo.calls.filter(call => call.command === 'write_acp' && (call.args.message as { result?: unknown }).result)).toHaveLength(0);
    await page.locator(`#open-sessions .session-row[aria-controls="${acpId}"]`).click();
    await permission.getByRole('button', { name: 'Allow fixture', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline ACP response.');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await page.locator(visible('model')).click();
    await expect(page.locator('#palette-list')).toContainText('Fixture large');
    await page.locator('#palette-input').fill('Fixture large');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('Fixture large');
    await page.locator(visible('prompt')).fill('/context');
    await page.locator(visible('prompt')).press('Tab');
    await expect(page.locator(visible('prompt'))).toHaveValue('/context ');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('messages'))).toContainText('Offline context only; no provider request.');
    const piStops = demo.calls.filter(call => call.command === 'stop_pi').length;
    const acpStops = demo.calls.filter(call => call.command === 'stop_acp').length;
    await page.locator(`#open-sessions .session-row[aria-controls="${acpId}"]`).locator('..').locator('.session-close').click();
    await expect(page.locator('#host-dialog-description')).toContainText('agent may keep its own saved history');
    await page.locator('#host-dialog button[value="ok"]').click();
    await expect(page.locator(`#${acpId}`)).toHaveCount(0);
    await expect(page.locator(visible('prompt'))).toHaveValue('Pi draft must survive');
    expect(demo.calls.filter(call => call.command === 'stop_pi')).toHaveLength(piStops);
    expect(demo.calls.filter(call => call.command === 'stop_acp')).toHaveLength(acpStops + 1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('ACP shared transcript preserves disclosure and reader intent while tools stream and Stop keeps the new draft', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const acpId = await newAcp(page);
    await page.locator(visible('prompt')).fill('First offline request'); await page.locator(visible('prompt')).press('Enter');
    await page.locator('.session-view:not([hidden]) .acp-permission').getByRole('button', { name: 'Allow fixture', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Paragraph 30');
    const firstCard = page.locator(`#${acpId} .tool-card`).first();
    await firstCard.locator('summary').first().click();
    const open = await firstCard.evaluate(card => (card as HTMLDetailsElement).open);
    await page.locator(visible('prompt')).fill('Second offline request'); await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('.session-view:not([hidden]) .acp-permission')).toBeVisible();
    await page.locator(visible('transcript-viewport')).evaluate(pane => { pane.scrollTop = 0; pane.dispatchEvent(new Event('scroll')); });
    await page.locator('.session-view:not([hidden]) .acp-permission').getByRole('button', { name: 'Allow fixture', exact: true }).click();
    await expect(page.locator(`#${acpId} .tool-card`).last().locator('.tool-output').first()).toContainText('fixture output');
    await expect.poll(async () => (await demo.metrics()).top).toBeLessThanOrEqual(2);
    expect(await firstCard.evaluate(card => (card as HTMLDetailsElement).open)).toBe(open);
    await page.locator(visible('prompt')).fill('Keep this newer draft');
    await page.locator(visible('send')).click();
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep this newer draft');
    expect(demo.calls.filter(call => call.command === 'write_acp' && (call.args.message as { method?: string }).method === 'session/prompt')).toHaveLength(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
