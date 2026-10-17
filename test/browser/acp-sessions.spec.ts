import { expect, test, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { copilotSessionScope } from '../../src/acp/profiles';
import { copilotHistoryKey } from '../../src/acp/session-history';

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
    await expect(permission).toContainText('Fixture shell output');
    await expect(permission.locator('.acp-permission-summary')).toHaveText('Run command · Fixture shell output');
    await expect(permission.locator('.acp-permission-command code')).toHaveText('printf fixture-only');
    const raw = permission.locator('.acp-permission-raw');
    await expect(raw).not.toHaveAttribute('open', '');
    await expect(permission.locator(':scope > .acp-permission-actions + .acp-permission-raw')).toHaveCount(1);
    await raw.locator('summary').click();
    await expect(raw.locator('pre')).toBeVisible();
    await expect(raw.locator('pre')).toContainText('fixture_shell');
    await raw.locator('summary').click();
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
    const mode = page.locator(`#${acpId} [data-control-id="mode"]`);
    await expect(mode).toHaveText('Fixture ask');
    await mode.click();
    await page.locator('#palette-input').fill('Fixture review');
    await page.locator('#palette-input').press('Enter');
    await expect(mode).toHaveText('Fixture review');
    await page.locator(visible('prompt')).fill('/context');
    await page.locator(visible('prompt')).press('Tab');
    await expect(page.locator(visible('prompt'))).toHaveValue('/context ');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('messages'))).toContainText('Offline context only; no provider request.');
    const piStops = demo.calls.filter(call => call.command === 'stop_pi').length;
    const acpStops = demo.calls.filter(call => call.command === 'stop_acp').length;
    await page.locator(`#open-sessions .session-row[aria-controls="${acpId}"]`).locator('..').locator('.session-close').click();
    await expect(page.locator('#host-dialog-description')).toContainText('Copilot’s saved history and your draft remain');
    await page.locator('#host-dialog button[value="ok"]').click();
    await expect(page.locator(`#${acpId}`)).toHaveCount(0);
    await expect(page.locator(visible('prompt'))).toHaveValue('Pi draft must survive');
    expect(demo.calls.filter(call => call.command === 'stop_pi')).toHaveLength(piStops);
    expect(demo.calls.filter(call => call.command === 'stop_acp')).toHaveLength(acpStops + 1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('remembered Copilot sidebar sessions load only on selection with draft and replayed history intact', async ({ page }) => {
  const scope = copilotSessionScope('fixture-acp');
  const demo = await demoFixture(page, {
    [`nimrod.tabs.v1:${process.cwd()}`]: {
      tabs: [{ kind: 'acp', profile: 'copilot', sessionId: 'fixture-acp', name: 'Remembered Copilot', lastUsed: 100 }],
      active: scope,
    },
  }, [], { persistent: false, drafts: { [scope]: { draft: 'Saved Copilot draft' } } });
  try {
    expect(demo.calls.filter(call => call.command === 'start_acp')).toHaveLength(1);
    expect(demo.calls.some(call => call.command === 'write_acp' && ['session/new', 'session/load', 'session/prompt'].includes(String((call.args.message as { method?: string }).method)))).toBe(false);
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Remembered Copilot' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator(visible('prompt'))).toHaveValue('Saved Copilot draft');
    await expect(page.locator(visible('messages'))).toContainText('Saved offline question');
    await expect(page.locator(visible('messages'))).toContainText('Saved offline answer');
    const requests = demo.calls.filter(call => call.command === 'write_acp').map(call => call.args.message as { method?: string; params?: unknown });
    expect(requests.filter(request => request.method === 'session/load')).toHaveLength(1);
    expect(requests.find(request => request.method === 'session/load')?.params).toEqual({ cwd: process.cwd(), sessionId: 'fixture-acp', mcpServers: [] });
    expect(requests.some(request => request.method === 'session/new' || request.method === 'session/prompt')).toBe(false);
    expect(demo.calls.filter(call => call.command === 'notify_session')).toHaveLength(0);
    await page.locator(visible('prompt')).fill('/context');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('messages'))).toContainText('Offline context only; no provider request.');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Resume discovers paginated offline Copilot history and loads its exact ID with the saved draft', async ({ page }) => {
  const scope = copilotSessionScope('fixture-acp');
  const demo = await demoFixture(page, { [copilotHistoryKey(process.cwd())]: true }, [], {
    persistent: false, drafts: { [scope]: { draft: 'Closed Copilot draft' } },
  });
  try {
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(1);
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-list')).toContainText('Saved offline conversation');
    await expect(page.locator('#palette-list')).not.toContainText('Outside project fixture');
    await page.locator('#palette-input').fill('Copilot');
    const option = page.locator('#palette-list [role="option"]');
    await expect(option).toHaveCount(1);
    await expect(option.locator('.session-indicator')).toHaveAttribute('data-state', 'closed');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator(visible('prompt'))).toHaveValue('Closed Copilot draft');
    await expect(page.locator(visible('messages'))).toContainText('Saved offline answer');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    const requests = demo.calls.filter(call => call.command === 'write_acp').map(call => call.args.message as { method?: string; params?: unknown });
    expect(requests.filter(request => request.method === 'session/list').map(request => request.params)).toEqual([
      { cwd: process.cwd() }, { cwd: process.cwd(), cursor: 'fixture-page-2' },
    ]);
    expect(requests.find(request => request.method === 'session/load')?.params).toEqual({ cwd: process.cwd(), sessionId: 'fixture-acp', mcpServers: [] });
    expect(requests.some(request => request.method === 'session/new' || request.method === 'session/prompt')).toBe(false);
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
