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
    await expect(page.locator(visible('session-metrics'))).toHaveText('~$0.000 · 0% / —');
    expect(demo.calls.some(call => call.command === 'write_copilot' && ['prompt', 'configure'].includes((call.args.message as { method?: string }).method || ''))).toBe(false);
    await page.locator(visible('prompt')).fill('Offline SDK request');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    const permission = page.locator('#command-palette');
    await expect(permission.locator('.acp-permission-summary')).toHaveText('Run command');
    await expect(permission.locator('.acp-permission-command')).toHaveText('printf fixture-only');
    await expect(permission.locator('#palette-context .acp-permission-raw')).toHaveCount(1);
    await expect(permission.locator('.acp-permission-raw')).not.toHaveAttribute('open', '');
    await expect(page.locator(`#${sdk} .message.user`)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(`#${sdk} .notice-pending`)).toContainText('Review requests');
    await page.locator(`#open-sessions .session-row[aria-controls="${pi}"]`).click();
    await expect(permission).toBeHidden();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep Pi draft');
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision')).toBe(false);
    await page.locator(`#open-sessions .session-row[aria-controls="${sdk}"]`).click();
    await page.locator(`#${sdk} .notice-pending`).getByRole('button', { name: 'Review requests' }).click();
    await permission.getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline SDK response.');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await expect(page.locator(visible('session-metrics'))).toHaveText('~$0.123 · 25.5% / 125k');
    await expect(page.locator(visible('session-metrics'))).toHaveAttribute('title', /12\.3 AIC/);
    const card = page.locator(`#${sdk} .tool-card`).first();
    await card.locator('summary').first().click();
    const disclosed = await card.evaluate(card => (card as HTMLDetailsElement).open);
    await page.locator(visible('model')).click();
    await page.locator('#palette-input').fill('Fixture large');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('large');
    await page.locator(visible('prompt')).fill('Second request');
    await page.locator(visible('prompt')).press('Enter');
    await permission.getByRole('option', { name: 'Allow once', exact: true }).click();
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

test('shell session choices use secondary parsed/scope details and honor the native capability flag', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    const full = 'git worktree add /fixture/tree -b task/example';
    const request = { kind: 'shell', canOfferSessionApproval: true, fullCommandText: full,
      commands: [{ identifier: full }], commandSegments: [{ identifier: 'git worktree', fullCommandText: full }] };
    const send = async (value: object) => {
      await page.locator(visible('prompt')).fill(`scoped permission fixture:${JSON.stringify(value)}`);
      await page.locator(visible('prompt')).press('Enter');
    };
    await send(request);
    const picker = page.locator('#command-palette');
    const session = picker.getByRole('option').filter({ hasText: 'Allow for this session' });
    await expect(session.locator('.palette-item-label')).toHaveText('Allow for this session');
    await expect(session.locator('.palette-item-description')).toHaveText(`Commands: git worktree\nApproval scope: ${full}`);
    expect(await session.locator('.palette-item-description').evaluate(node => getComputedStyle(node).whiteSpace)).toBe('pre-wrap');
    await picker.locator('#palette-input').fill('git worktree');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await session.click();
    await expect(picker).toBeHidden(); await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    const decisions = () => demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision');
    expect((decisions()[0].args.message as { value: unknown }).value).toEqual({
      kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: [full] },
    });
    await send({ ...request, canOfferSessionApproval: false });
    await expect(picker).toBeVisible(); await expect(session).toHaveCount(0);
    await expect(picker.getByRole('option')).toHaveCount(3);
    await picker.getByRole('option', { name: 'Deny', exact: true }).click();
    await expect(picker).toBeHidden();
    expect((decisions()[1].args.message as { value: unknown }).value).toEqual({ kind: 'reject' });
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('permission picker retains one shell, nests feedback and resumes through a pinned banner above independent errors', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!;
      const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
      dialog.dataset.opens = '0'; dialog.dataset.closes = '0';
      dialog.showModal = () => { dialog.dataset.opens = String(Number(dialog.dataset.opens) + 1); show(); };
      dialog.close = value => { dialog.dataset.closes = String(Number(dialog.dataset.closes) + 1); close(value); };
    });
    await page.locator(visible('prompt')).fill('parallel permission fixture'); await page.locator(visible('prompt')).press('Enter');
    const picker = page.locator('#command-palette'), remaining = picker.locator('#palette-remaining');
    await expect(remaining).toHaveText('2 more'); await expect(picker).toHaveAttribute('data-opens', '1');
    await picker.getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(remaining).toHaveText('1 more'); await expect(picker).toHaveAttribute('data-closes', '0');
    await picker.getByRole('option', { name: /Deny with feedback/ }).click();
    const child = page.locator('#host-dialog');
    await expect(child).toBeVisible(); await expect(picker).toBeVisible();
    await expect(child.locator('textarea')).toBeFocused();
    const before = await picker.boundingBox();
    await page.keyboard.press('Escape');
    await expect(child).toBeHidden(); await expect(picker.locator('#palette-input')).toBeFocused();
    expect(await picker.boundingBox()).toEqual(before);
    const decisions = () => demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision');
    expect(decisions()).toHaveLength(1);
    await picker.getByRole('option', { name: /Deny with feedback/ }).click();
    await child.locator('textarea').fill('Use another approach');
    await child.getByRole('button', { name: 'Send denial', exact: true }).click();
    await expect(child).toBeHidden(); await expect(remaining).toHaveText('Last request');
    await expect(picker).toHaveAttribute('data-closes', '0');
    await page.keyboard.press('Escape'); await expect(picker).toBeHidden();
    const banner = page.locator('.session-view:not([hidden]) .notice-pending');
    await expect(banner).toContainText('1 request'); await expect(banner.locator('[data-dismiss]')).toHaveCount(0);
    const token = String(demo.calls.find(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'prompt')!.args.token);
    await page.evaluate(token => {
      const host = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      for (let i = 0; i < 12; i++) host.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { kind: 'command-error', error: `Independent fixture error ${i}` } });
    }, token);
    const notices = page.locator(visible('session-notices')), errors = notices.locator('.notice-list');
    await expect(errors.locator('.application-notice')).toHaveCount(12);
    await expect(notices.locator('.notice-group')).toHaveCount(0);
    const bannerTop = (await banner.boundingBox())!.y;
    await errors.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect((await banner.boundingBox())!.y).toBe(bannerTop);
    await expect(banner.getByRole('button', { name: 'Review requests' })).toBeInViewport();
    await page.locator(visible('prompt')).fill('Keep newer draft');
    await banner.getByRole('button', { name: 'Review requests' }).click();
    await expect(picker).toBeVisible();
    await picker.getByRole('option', { name: 'Deny', exact: true }).click();
    await expect(picker).toBeHidden(); await expect(banner).toBeHidden();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep newer draft');
    await expect(picker).toHaveAttribute('data-opens', '2'); await expect(picker).toHaveAttribute('data-closes', '2');
    expect(decisions().map(call => (call.args.message as { value: unknown }).value)).toEqual([
      { kind: 'approve-once', approvedInteractively: true }, { kind: 'reject', feedback: 'Use another approach' }, { kind: 'reject' },
    ]);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('busy SDK configuration updates one queued transcript row and applies at idle without pending status or reader navigation', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('small');
    const prompt = page.locator(visible('prompt'));
    const permission = page.locator('#command-palette');
    await prompt.fill('First fixture turn'); await prompt.press('Enter');
    await permission.getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline SDK response.');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await prompt.fill('Second fixture turn'); await prompt.press('Enter');
    await permission.getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Stop Copilot');
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const top = (await demo.metrics()).top;
    await prompt.fill('Keep newer draft');
    const selectModel = async (label: string) => {
      await page.locator(visible('model')).click();
      await page.locator('#palette-input').fill(label); await page.locator('#palette-input').press('Enter');
    };
    await selectModel('Fixture large');
    const row = page.locator('.session-view:not([hidden]) .message.configuration');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.delivery-status-shimmer')).toHaveText('Model change queued');
    await row.evaluate(node => { node.setAttribute('data-fixture-identity', 'configuration'); });
    await row.locator('.delivery-status-text').evaluate(node => { node.setAttribute('data-fixture-title', 'retained'); });
    await expect(page.locator(visible('model'))).toHaveText('small');
    await selectModel('Fixture small');
    await expect(row.locator('.configuration-text')).toContainText('Fixture small');
    await selectModel('Fixture large');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-fixture-identity', 'configuration');
    await expect(row.locator('.delivery-status-text')).toHaveAttribute('data-fixture-title', 'retained');
    await expect(row.locator('.configuration-text')).toContainText('Fixture large');
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'configure')).toBe(false);
    expect(Math.abs((await demo.metrics()).top - top)).toBeLessThanOrEqual(2);
    await expect(prompt).toHaveValue('Keep newer draft');
    await page.locator(visible('send')).click();
    await expect(page.locator(visible('model'))).toHaveText('large');
    await expect(row.locator('.delivery-status-shimmer')).toHaveCount(0);
    await expect(row).toHaveAttribute('data-fixture-identity', 'configuration');
    await expect(prompt).toHaveValue('Keep newer draft');
    const configuration = demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'configure');
    expect(configuration).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('SDK configuration accepted before the first prompt stays at the start as conversation arrives', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('small');
    await page.locator(visible('model')).click();
    await page.locator('#palette-input').fill('Fixture large'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('large');
    const messages = page.locator(visible('messages'));
    const row = messages.locator('.message.configuration');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.delivery-status-text')).toHaveText('Configuration changed');
    await expect(row.locator('.delivery-status-shimmer')).toHaveCount(0);
    await row.evaluate(node => { node.setAttribute('data-fixture-identity', 'accepted-before-first-prompt'); });
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('First turn after configuration'); await prompt.press('Enter');
    await page.locator('#command-palette').getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(messages).toContainText('Offline SDK response.');
    await expect(messages.locator(':scope > .message').first()).toHaveAttribute('data-fixture-identity', 'accepted-before-first-prompt');
    await expect(messages.locator('.queued-turns .message.configuration')).toHaveCount(0);
    await expect(row).not.toHaveClass(/sticky-turn/);
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await prompt.fill('More output after configuration'); await prompt.press('Enter');
    await page.locator('#command-palette').getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Stop Copilot');
    await prompt.fill('Keep newer draft');
    await expect(messages.locator(':scope > .message').first()).toHaveAttribute('data-fixture-identity', 'accepted-before-first-prompt');
    await expect(row.locator('.delivery-status-shimmer')).toHaveCount(0);
    await expect(prompt).toHaveValue('Keep newer draft');
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
    await expect(page.locator(visible('session-metrics'))).toHaveText('~$0.123 · 25.5% / 125k');
    await expect(page.locator(visible('session-metrics'))).toHaveAttribute('title', /31,875 \/ 125,000 tokens/);
    const requests = demo.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as { method?: string; sessionId?: string });
    expect(requests.filter(request => request.method === 'connect').map(request => request.sessionId)).toEqual(['fixture-sdk']);
    expect(requests.some(request => request.method === 'prompt')).toBe(false);
    expect(demo.calls.some(call => call.command === 'notify_session')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
