import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { copilotSdkScope } from '../../src/copilot/session-lifecycle';
import { copilotHistoryKey } from '../../src/copilot/session-history';

test('offline SDK bridge uses the shared shell for optimistic send, permissions, tools, model and Stop', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const pi = await page.locator('.session-view:not([hidden])').getAttribute('id');
    await page.locator(visible('prompt')).fill('Keep Pi draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#mode-badge')).toHaveText('Copilot');
    await expect(page.locator(visible('send'))).toBeEnabled();
    const sdk = await page.locator('.session-view:not([hidden])').getAttribute('id');
    await expect(page.locator(visible('model'))).toHaveText('small');
    await expect(page.locator(visible('thinking'))).toHaveText('low');
    expect(demo.calls.some(call => call.command === 'write_copilot' && ['prompt', 'configure'].includes((call.args.message as { method?: string }).method || ''))).toBe(false);
    await page.locator(visible('prompt')).fill('Offline SDK request');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    const permission = page.locator(`#${sdk} .acp-permission`);
    await expect(permission).toContainText('printf fixture-only');
    await expect(page.locator(`#${sdk} .message.user`)).toHaveCount(1);
    await page.locator(`#open-sessions .session-row[aria-controls="${pi}"]`).click();
    await expect(permission).toBeHidden();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep Pi draft');
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision')).toBe(false);
    await page.locator(`#open-sessions .session-row[aria-controls="${sdk}"]`).click();
    await permission.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline SDK response.');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    const card = page.locator(`#${sdk} .tool-card`).first();
    await card.locator('summary').first().click();
    const disclosed = await card.evaluate(card => (card as HTMLDetailsElement).open);
    await page.locator(visible('model')).click();
    await page.locator('#palette-input').fill('Fixture large');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('large');
    await page.locator(visible('prompt')).fill('Second request');
    await page.locator(visible('prompt')).press('Enter');
    await permission.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(`#${sdk} .tool-card`).last()).toContainText('fixture output');
    expect(await card.evaluate(card => (card as HTMLDetailsElement).open)).toBe(disclosed);
    await page.locator(visible('prompt')).fill('Keep newer draft');
    await page.locator(visible('send')).click();
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep newer draft');
    expect(demo.calls.some(call => call.command === 'start_acp')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('SDK discovery never resumes automatically; selection uses the exact ID and SDK-only draft', async ({ page }) => {
  const scope = copilotSdkScope('fixture-sdk');
  const demo = await demoFixture(page, { [copilotHistoryKey(process.cwd())]: true }, [], {
    persistent: false, drafts: { [scope]: { draft: 'SDK-only draft' } },
  });
  try {
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'connect')).toBe(false);
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-list')).toContainText('Saved SDK conversation');
    await expect(page.locator('#palette-list')).not.toContainText('Outside project fixture');
    await page.locator('#palette-input').fill('Saved SDK conversation');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator(visible('prompt'))).toHaveValue('SDK-only draft');
    await expect(page.locator(visible('messages'))).toContainText('Saved SDK answer');
    const requests = demo.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as { method?: string; sessionId?: string });
    expect(requests.filter(request => request.method === 'connect').map(request => request.sessionId)).toEqual(['fixture-sdk']);
    expect(requests.some(request => request.method === 'prompt')).toBe(false);
    expect(demo.calls.some(call => call.command === 'notify_session')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
