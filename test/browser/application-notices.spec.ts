import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('session notices stay inside their conversation, preserving reader intent, focus and background isolation', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.theme":"dracula"}');
    for (let i = 1; i <= 4; i++) await fixture.turn(i);
    const firstToken = String(fixture.calls.find(call => call.command === 'start_pi')!.args.token);
    const firstRoot = page.locator('.session-view').first();
    const pane = page.locator(visible('transcript-viewport'));
    await pane.hover(); await page.mouse.wheel(0, -10000);
    await expect.poll(async () => (await fixture.metrics()).gap).toBeGreaterThan(80);
    const before = await fixture.metrics();
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep draft'); await prompt.focus();
    await page.locator(visible('messages')).locator('.message').first().evaluate(node => { (node as HTMLElement).dataset.identity = 'retained'; });
    const report = async (token: string, id: string, message: string) => page.evaluate(({ token, id, message }) => {
      const state = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      state.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', notifyType: 'error', id, message } });
    }, { token, id, message });
    await report(firstToken, 'one', 'Playwright MCP server could not start. ' + 'Diagnostic ENOENT '.repeat(20));
    const notice = page.locator(visible('session-notices'));
    await expect(notice).toBeVisible(); await expect(page.locator('#application-notices')).toBeHidden();
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Keep draft');
    expect(Math.abs((await fixture.metrics()).top - before.top)).toBeLessThanOrEqual(2);
    const bounds = (await notice.boundingBox())!, conversation = (await firstRoot.boundingBox())!;
    expect(bounds.x - conversation.x).toBeCloseTo(25, 0); // 20px gutter at fixture zoom.
    expect(bounds.width).toBeLessThan(conversation.width);
    expect((await pane.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    await expect(notice.locator('.notice-details')).not.toHaveAttribute('open', '');
    await notice.getByText('Details', { exact: true }).click();
    await expect(notice.locator('.notice-details')).toHaveAttribute('open', '');
    await expect(page.locator(visible('messages')).locator('.message').first()).toHaveAttribute('data-identity', 'retained');
    expect(Math.abs((await fixture.metrics()).top - before.top)).toBeLessThanOrEqual(2);
    await page.keyboard.press('ControlOrMeta+Shift+n'); await expect(page.locator('.session-view')).toHaveCount(2);
    await expect(page.locator(visible('send'))).toBeEnabled();
    const secondPrompt = page.locator(visible('prompt')); await secondPrompt.fill('Second draft'); await secondPrompt.focus();
    await report(firstToken, 'background', 'Another first-session issue');
    await expect(page.locator(visible('session-notices'))).toBeHidden();
    await expect(page.locator('#application-notices')).toBeHidden(); await expect(secondPrompt).toBeFocused();
    await page.locator(`.session-row[aria-controls="${await firstRoot.getAttribute('id')}"]`).click();
    await expect(notice.locator('.notice-group-summary')).toHaveText('2 session issues');
    await expect(notice.locator('.notice-group')).not.toHaveAttribute('open', '');
    await notice.locator('.notice-group-summary').click();
    await expect(notice).toContainText('Another first-session issue');
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-page .session-notices')).toHaveCount(0);
    await expect(page.locator('#application-notices')).toBeHidden();
    await page.locator('#settings-back').click();
    await expect(notice.locator('.notice-group')).toHaveAttribute('open', '');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('session notices use the theme error outline, message-first text and preserved Details across dark/light themes', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const token = String(fixture.calls.find(call => call.command === 'start_pi')!.args.token);
    const message = 'MCP servers need attention: playwright failed. ' + 'spawn /fixture/playwright ENOENT '.repeat(8) + 'Run /mcp to fix.';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep styling draft'); await prompt.focus();
    await page.evaluate(({ token, message }) => {
      const state = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      for (const severity of ['warning', 'error', 'info']) state.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', notifyType: severity, id: severity, message } });
    }, { token, message });
    const notices = page.locator(visible('session-notices'));
    await expect(notices).toBeVisible(); await expect(prompt).toBeFocused();
    await notices.locator('.notice-group-summary').click();
    const row = notices.locator('.application-notice').first();
    await expect(row.locator('strong')).toHaveText(message.slice(0, 157) + '…');
    await expect(row.locator('.notice-message')).toHaveCount(0);
    await expect(notices).not.toContainText('Pi operation');
    await row.locator('.notice-details > summary').click();
    await expect(row.locator('.notice-details > div')).toHaveText(message);
    await row.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'retained'; });
    const colors = new Set<string>();
    for (const theme of ['dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme }));
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const styling = await notices.evaluate(node => {
        const probe = document.createElement('span'); node.append(probe);
        const color = (value: string) => { probe.style.color = value; return getComputedStyle(probe).color; };
        const error = color('var(--vscode-errorForeground)');
        const border = color('color-mix(in srgb, var(--vscode-errorForeground) 60%, transparent)');
        const foreground = color('var(--vscode-foreground)'); probe.remove();
        const style = getComputedStyle(node);
        return { border: style.borderTopColor, expectedBorder: border, width: style.borderTopWidth, type: style.borderTopStyle,
          icons: [...node.querySelectorAll('.notice-icon')].map(icon => getComputedStyle(icon).color), error,
          headline: getComputedStyle(node.querySelector('strong')!).color, foreground };
      });
      expect(styling.border).toBe(styling.expectedBorder); expect(styling.width).toBe('1px'); expect(styling.type).toBe('solid');
      expect(styling.icons).toEqual([styling.error, styling.error, styling.error]);
      expect(styling.headline).toBe(styling.foreground); colors.add(styling.border);
      await expect(row).toHaveAttribute('data-test-identity', 'retained');
      await expect(row.locator('.notice-details')).toHaveAttribute('open', '');
      await expect(row.locator('.notice-details > div')).toHaveText(message);
    }
    expect(colors.size).toBe(2);
    await expect(prompt).toHaveValue('Keep styling draft'); await expect(page.locator('#application-notices')).toBeHidden();
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const wrapped of [false, true]) test(`session notice first-line alignment and transcript gap survive ${wrapped ? 'wrapped text and expanded Details' : 'a single-line message'}`, async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const fixture = await demoFixture(page);
  try {
    const token = String(fixture.calls.find(call => call.command === 'start_pi')!.args.token);
    const message = wrapped ? 'MCP servers need attention. ' + 'Playwright could not start. '.repeat(10) : 'MCP server needs attention.';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep alignment draft'); await prompt.focus();
    await page.evaluate(({ token, message }) => {
      const state = window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      state.__fixtureChannels[token].onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', notifyType: 'error', id: 'alignment', message } });
    }, { token, message });
    const notice = page.locator(visible('session-notices'));
    await expect(notice).toBeVisible(); await expect(prompt).toBeFocused();
    const geometry = () => notice.evaluate(node => {
      const title = node.querySelector<HTMLElement>('strong')!, slot = node.querySelector<HTMLElement>('.notice-icon')!;
      const icon = slot.querySelector('svg')!.getBoundingClientRect();
      const close = node.querySelector('[data-dismiss] svg')!.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect(), bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node), line = Number.parseFloat(getComputedStyle(title).lineHeight);
      const scale = slot.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(slot).height);
      const firstLineCenter = titleBounds.y + line * scale / 2;
      const viewport = node.closest('.session-view')!.querySelector('[data-pi-id="transcript-viewport"]')!.getBoundingClientRect();
      return { iconOffset: (icon.y + icon.height / 2 - firstLineCenter) / scale,
        closeOffset: (close.y + close.height / 2 - firstLineCenter) / scale,
        lines: titleBounds.height / (line * scale), gap: (viewport.y - bounds.bottom) / scale,
        topInset: (titleBounds.y - bounds.y) / scale, bottomInset: (bounds.bottom - titleBounds.bottom) / scale,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
    });
    const before = await geometry();
    expect(Math.abs(before.iconOffset)).toBeLessThanOrEqual(.5); expect(Math.abs(before.closeOffset)).toBeLessThanOrEqual(.5);
    expect(before.gap).toBeCloseTo(12, 0); expect(before.paddingTop).toBe('8px'); expect(before.paddingBottom).toBe('8px');
    if (wrapped) {
      expect(before.lines).toBeGreaterThan(1);
      await notice.locator('.notice-details > summary').click();
      await expect(notice.locator('.notice-details > div')).toHaveText(message);
      const expanded = await geometry();
      expect(Math.abs(expanded.iconOffset)).toBeLessThanOrEqual(.5); expect(Math.abs(expanded.closeOffset)).toBeLessThanOrEqual(.5);
      expect(expanded.gap).toBeCloseTo(12, 0);
    } else {
      expect(before.lines).toBeCloseTo(1, 0);
      expect(Math.abs(before.topInset - before.bottomInset)).toBeLessThanOrEqual(.5);
    }
    await page.locator(visible('transcript-viewport')).evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect((await geometry()).gap).toBeCloseTo(12, 0);
    await notice.getByRole('button', { name: 'Dismiss notice', exact: true }).click();
    await expect(notice).toBeHidden(); await expect(prompt).toHaveValue('Keep alignment draft');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('window strip keeps its position and remains actionable through Settings and nested native dialogs', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Keep my draft');
    await fixture.editPreferences('{"appearance.zoom":126}');
    const strip = page.locator('#application-notices');
    await expect(strip).toBeVisible(); await expect(strip).toContainText('Read settings');
    const position = await strip.boundingBox();
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-page > #application-notices')).toBeVisible();
    expect(Math.abs((await strip.boundingBox())!.y - position!.y)).toBeLessThanOrEqual(1);
    await page.locator('#settings-category-keybindings').click();
    await page.locator('.keybinding-row[data-action="sidebar"]').getByRole('button', { name: /^Add/ }).click();
    await expect(page.locator('#keybinding-recorder > #application-notices')).toBeVisible();
    expect(Math.abs((await strip.boundingBox())!.y - position!.y)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Dismiss Read settings', exact: true }).click();
    await expect(strip).toBeHidden(); await expect(page.locator('#keybinding-recorder')).toBeVisible();
    await expect(page.locator('#keybinding-record')).toBeFocused();
    await page.keyboard.press('Escape'); await page.locator('#settings-back').click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep my draft');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('notification timeout has an accessible Dismiss control in Settings and the conversation without retrying', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.evaluate(() => {
      const state = window as unknown as { __fixtureHost(command: string, args: Record<string, unknown>): Promise<unknown> };
      const original = state.__fixtureHost;
      state.__fixtureHost = async (command, args) => {
        if (command === 'test_notification') throw new Error('macOS notification settings lookup timed out; nothing will be retried');
        return original(command, args);
      };
    });
    const strip = page.locator('#application-notices');
    const dismiss = strip.getByRole('button', { name: 'Dismiss Desktop notifications', exact: true });
    for (const surface of ['Settings', 'conversation']) {
      await page.locator('#open-settings').click();
      await page.locator('#settings-category-notifications').click();
      await page.locator('#notification-test').click();
      await expect(strip).toContainText('macOS notification settings lookup timed out');
      if (surface === 'conversation') await page.locator('#settings-back').click();
      await expect(dismiss).toBeInViewport();
      await expect(dismiss).toBeEnabled();
      const calls = fixture.calls.length;
      // WebKit pointer clicks need not focus buttons; exercise keyboard dismissal
      // from a known Settings focus owner as well as pointer dismissal outside it.
      if (surface === 'Settings') {
        await page.locator('#notification-test').focus();
        await dismiss.focus();
        await page.keyboard.press('Enter');
      } else await dismiss.click();
      await expect(strip).toBeHidden();
      expect(fixture.calls.length).toBe(calls);
      if (surface === 'Settings') {
        await expect(page.locator('#settings-page')).toBeVisible();
        await expect(page.locator('#notification-test')).toBeFocused();
        await page.locator('#settings-back').click();
      }
    }
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('runtime validation uses the strip, not an inline error or native validation popup', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click(); await page.locator('#settings-category-runtime').click();
    await page.locator('#pi-path').fill(''); await page.locator('#save-runtime').click();
    await expect(page.locator('#application-notices')).toContainText('Save runtime paths');
    await expect(page.locator('#application-notices')).toContainText('non-empty');
    await expect(page.locator('#runtime-status')).not.toContainText('Not saved');
    await expect(page.locator('#settings-page')).toBeVisible();
    await page.locator('#pi-path').fill('/fixture/pi');
    await page.locator('#save-runtime').click();
    await expect(page.locator('#application-notices')).toBeHidden();
    await expect(page.locator('#runtime-status')).toContainText('Saved.');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('connection loss before acceptance has one dismissible uncertainty notice without draft recovery or focus changes', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.evaluate(() => {
      const state = window as unknown as { __fixtureHost(command: string, args: Record<string, unknown>): Promise<unknown>; __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> };
      const original = state.__fixtureHost;
      state.__fixtureHost = async (command, args) => {
        if (command === 'write_pi' && (args.message as { type?: string })?.type === 'prompt') {
          state.__fixtureChannels[String(args.token)].onmessage({ kind: 'disconnected', message: 'Offline fixture disconnected before receipt' }); return;
        }
        return original(command, args);
      };
    });
    const prompt = page.locator(visible('prompt')); await prompt.fill('Maybe received'); await prompt.press('Enter');
    const sessionNotice = page.locator(visible('session-notices'));
    await expect(sessionNotice.locator('.application-notice')).toHaveCount(1);
    await expect(sessionNotice).toContainText('Message delivery unknown');
    await expect(page.locator('#application-notices')).toBeHidden();
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('');
    await expect(page.locator(visible('submission-notice'))).toBeHidden();
    await expect(page.locator('.session-view:not([hidden]) .tab-notice')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Write a new message', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss Message delivery unknown', exact: true }).click();
    await expect(prompt).toHaveValue('');
    await expect(page.locator('#application-notices')).toBeHidden();
    await expect(sessionNotice).toBeHidden();
    await prompt.fill('New draft after disconnect');
    await expect(page.locator(visible('send'))).toBeDisabled();
    await expect(prompt).toHaveValue('New draft after disconnect');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
