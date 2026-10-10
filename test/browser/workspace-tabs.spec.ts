import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const sessions = '#open-sessions .session-row';

async function newOfflineDemo(page: Parameters<typeof demoFixture>[0]): Promise<void> {
  const count = await page.locator(sessions).count();
  await page.keyboard.press('Meta+Shift+P');
  await page.locator('#palette-input').fill('new offline demo');
  await page.locator('#palette-input').press('Enter');
  await expect(page.locator(sessions)).toHaveCount(count + 1);
  await expect(page.locator(visible('send'))).toBeEnabled();
}

test('sidebar sessions keep independent drafts and a background agent live without a tab strip', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await expect(page.locator('#session-sidebar')).toBeVisible();
    await expect(page.locator(sessions)).toHaveCount(1);
    await expect(page.locator(sessions)).not.toHaveAttribute('title');
    await expect(page.locator('#sidebar-workspace, #sidebar-directory, #open-section, .sidebar-actions')).toHaveCount(0);
    await expect(page.locator('#session-tabs, #all-section')).toHaveCount(0);
    await expect(page.locator('#open-workspace, #open-palette, #disconnect')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restart session', exact: true })).toBeVisible();
    await expect(page.locator('#restart-session')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete session tree', exact: true })).toBeVisible();
    await expect(page.locator('#delete-session')).toBeDisabled();
    await demo.turn(1);
    const firstPanel = await page.locator('.session-view').getAttribute('id');
    const firstRow = page.locator(`#open-sessions .session-row[aria-controls="${firstPanel}"]`);
    const secondRow = page.locator(`#open-sessions .session-row:not([aria-controls="${firstPanel}"])`);
    await page.locator(visible('prompt')).fill('First session draft');
    await newOfflineDemo(page);
    await expect(page.locator(sessions)).toHaveCount(2);
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await page.locator(visible('prompt')).fill('Second session draft');
    await page.keyboard.press('Meta+Shift+[');
    await expect(page.locator(visible('prompt'))).toHaveValue('First session draft');
    await page.locator(visible('prompt')).fill('Continue in background');
    await page.locator(visible('prompt')).press('Enter');
    await expect(firstRow).toHaveAttribute('aria-label', /Working/);
    await secondRow.click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Second session draft');
    await expect(firstRow).toHaveAttribute('aria-label', /Unread/);
    await expect(page.locator('#sidebar-all')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => demo.calls.filter(c => c.command === 'prepare_notifications')).toHaveLength(1);
    await expect.poll(() => demo.calls.filter(c => c.command === 'notify_session')).toHaveLength(1);
    await expect(page.locator('#notification-status')).toHaveText(/Last completed alert: submitted to the OS/);
    expect(demo.calls.find(c => c.command === 'notify_session')?.args).toMatchObject({ kind: 'completed', selected: false, preview: expect.any(String) });
    expect(demo.children.size).toBe(2);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    await firstRow.click();
    await expect(page.locator(`#${firstPanel}`)).toBeVisible();
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.locator('#toggle-sidebar').click();
    await expect(page.locator('#session-sidebar')).toBeHidden();
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.locator('#toggle-sidebar').click();
    await expect(page.locator('#session-sidebar')).toBeVisible();
    expect(demo.errors).toEqual([]);
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  } finally { await demo.close(); }
});

test('All, Switch and next/previous share one order through creation and acknowledged prompts', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await newOfflineDemo(page); await newOfflineDemo(page);
    const order = () => page.locator(sessions).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-controls')!));
    const checkConsumers = async () => {
      const displayed = await order();
      const titles = await page.locator(`${sessions} .session-row-label`).allTextContents();
      const times = await page.locator(`${sessions} time`).evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')));
      await page.keyboard.press('Meta+t');
      const options = page.locator('#palette-list [role=option]');
      expect(await options.locator('.palette-item-label').allTextContents()).toEqual(titles);
      expect(await options.locator('time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime')))).toEqual(times);
      await page.keyboard.press('Escape');
      await page.locator(`${sessions}[aria-controls="${displayed[0]}"]`).click();
      for (const shortcut of ['Meta+Shift+]', 'Meta+Shift+[']) {
        const step = shortcut.endsWith(']') ? 1 : -1;
        for (let i = 1; i <= displayed.length; i++) {
          await page.keyboard.press(shortcut);
          await expect(page.locator(`${sessions}[aria-current="true"]`)).toHaveAttribute('aria-controls', displayed[(i * step + displayed.length) % displayed.length]);
        }
      }
      expect(await order()).toEqual(displayed);
    };
    await checkConsumers();
    const before = await order();
    await page.locator(`${sessions}[aria-controls="${before[2]}"]`).click();
    await page.locator(visible('prompt')).fill('Acknowledged recency changes every navigation consumer');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(sessions).first()).toHaveAttribute('aria-controls', before[2]);
    await expect(page.locator(visible('send'))).toHaveAttribute('title', /Send/);
    await checkConsumers();
    expect(demo.children.size).toBe(3);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('notification navigation overrides reading position but ordinary switching preserves it', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const firstPanel = await page.locator('.session-view').getAttribute('id');
    const firstRow = page.locator(`#open-sessions .session-row[aria-controls="${firstPanel}"]`);
    const pane = page.locator(visible('transcript-viewport'));
    await pane.hover(); await page.mouse.wheel(0, -10000);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const reading = (await demo.metrics()).top;
    await newOfflineDemo(page);
    await firstRow.click();
    await expect.poll(async () => Math.abs((await demo.metrics()).top - reading)).toBeLessThanOrEqual(2);
    // Complete in the background so the mocked notification carries the real target.
    await page.locator(visible('prompt')).fill('Notification target response');
    await page.locator(visible('prompt')).press('Enter');
    await page.locator(`#open-sessions .session-row:not([aria-controls="${firstPanel}"])`).click();
    await expect.poll(() => demo.calls.filter(c => c.command === 'notify_session').length).toBe(1);
    const target = demo.calls.find(c => c.command === 'notify_session')!.args.target as { session: string; token: string };
    await page.locator('#sidebar-working').click();
    await expect(page.locator('#conversation')).toBeHidden();
    await page.locator('#open-settings').click();
    const starts = demo.calls.filter(c => c.command === 'start_pi').length;
    await demo.notificationClick(target);
    await expect(page.locator('#settings-page')).not.toBeVisible();
    await expect(page.locator(`#${firstPanel}`)).toBeVisible();
    await expect(page.locator('#sidebar-all')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.calls.filter(c => c.command === 'focus_notification_window')).toHaveLength(1);
    expect(demo.calls.filter(c => c.command === 'start_pi')).toHaveLength(starts);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('counted sidebar filters show working sessions and retain the selected response after settlement', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await expect(page.getByRole('tab', { name: 'All (1)', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Unread (0)', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Working (0)', exact: true })).toBeVisible();
    await page.locator(visible('prompt')).fill('Work in the counted view');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('#sidebar-working-count')).toHaveText('1');
    await page.locator('#sidebar-working').click();
    await expect(page.locator('#sidebar-working')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.open-session:not([hidden])')).toHaveCount(1);
    await expect(page.locator('#conversation')).toBeVisible();
    await expect(page.locator('#sidebar-working-count')).toHaveText('0');
    await expect(page.locator('.open-session:not([hidden])')).toHaveCount(1);
    await expect(page.locator(visible('send'))).toBeEnabled();
    await expect(page.locator('#sidebar-unread-count')).toHaveText('0');
    await page.locator('#sidebar-all').click(); await page.locator('#sidebar-working').click();
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator('#sidebar-empty')).toHaveText('No sessions working.');
    await page.locator('#sidebar-working').press('ArrowRight');
    await expect(page.locator('#sidebar-all')).toBeFocused();
    await expect(page.locator('#conversation')).toBeVisible();
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('temporary Close uses Escape to cancel and Enter to confirm without replaying the draft', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep until confirmed');
    const stops = demo.calls.filter(c => c.command === 'stop_pi').length;
    await page.locator('.session-close').click();
    await expect(page.locator('#host-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#host-dialog')).not.toBeVisible();
    await expect(page.locator(sessions)).toHaveCount(1);
    await expect(prompt).toHaveValue('Keep until confirmed');
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(stops);
    await page.locator('.session-close').click();
    // Enter must confirm even with the Cancel button focused.
    await page.locator('#host-dialog button[value="cancel"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#host-dialog')).not.toBeVisible();
    await expect(page.locator(sessions)).toHaveCount(0);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(stops + 1);
    expect(demo.calls.some(c => (c.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Settings test notification is recorded without running another agent and Off disables it', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const starts = demo.calls.filter(c => c.command === 'start_pi').length;
    const stops = demo.calls.filter(c => c.command === 'stop_pi').length;
    await page.locator('#open-settings').click();
    await page.getByRole('button', { name: 'Send test notification', exact: true }).click();
    await expect(page.locator('#notification-status')).toHaveText(/Test notification submitted to the OS/);
    expect(demo.calls.filter(c => c.command === 'test_notification')).toHaveLength(1);
    await page.locator('#notification-mode').selectOption('off');
    await expect(page.locator('#notification-test')).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh notification diagnostics', exact: true }).click();
    await expect(page.locator('#notification-status')).toHaveText(/Notification diagnostics.*foreground handler calls: 1/);
    expect(demo.calls.filter(c => c.command === 'notification_diagnostics')).toHaveLength(2);
    expect(demo.calls.filter(c => c.command === 'test_notification')).toHaveLength(1);
    expect(demo.calls.filter(c => c.command === 'start_pi')).toHaveLength(starts);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(stops);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('attention hides the entire conversation and restores mounted draft, disclosures and reader position in All', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const panel = (await page.locator('.session-view').getAttribute('id'))!;
    await page.locator(visible('prompt')).fill('Preserved draft');
    const tool = page.locator(`#${panel} .tool-card`).first();
    await tool.locator('summary').first().click();
    await expect(tool).toHaveAttribute('open', '');
    const pane = page.locator(visible('transcript-viewport'));
    await pane.hover(); await page.mouse.wheel(0, -500);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(80);
    const position = (await demo.metrics()).top;
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator('#workspace-empty')).toBeHidden();
    await expect(page.locator('.session-view:not([hidden])')).toHaveCount(0);
    await expect(page.locator('#mode-badge')).toBeEmpty();
    await expect(page.locator('#restart-session')).toBeDisabled();
    await expect(page.locator('#delete-session')).toBeDisabled();
    await page.getByRole('tab', { name: /^All \(\d+\)$/ }).click();
    await expect(page.locator(`#${panel}`)).toBeVisible();
    await expect(page.locator(visible('prompt'))).toHaveValue('Preserved draft');
    await expect(tool).toHaveAttribute('open', '');
    await expect.poll(async () => Math.abs((await demo.metrics()).top - position)).toBeLessThanOrEqual(2);
    expect(demo.children.size).toBe(1);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('empty Unread shows working status with a reduced-motion-aware pulse', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Work while this session is hidden');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(sessions)).toHaveAttribute('aria-label', /Working/);
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator('#workspace-empty')).toBeHidden();
    await expect(page.locator('#sidebar-empty')).toBeVisible();
    await expect(page.locator('#sidebar-empty')).toHaveText('1 session working…');
    await expect(page.locator('#sidebar-unread-count')).toHaveText('0');
    const dots = page.locator('#sidebar-empty-dots');
    await expect(dots).toBeVisible();
    await expect(dots).toHaveCSS('animation-name', 'sidebar-working-pulse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(dots).toHaveCSS('animation-name', 'none');
    await expect(page.locator('#sidebar-empty')).toHaveText('1 session working…');
    await expect(page.locator(sessions)).toHaveAttribute('aria-label', /Unread/);
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator('#sidebar-unread-count')).toHaveText('1');
    await page.locator(sessions).click();
    await expect(page.locator('#conversation')).toBeVisible();
    await expect(page.locator('#sidebar-unread-count')).toHaveText('0');
    await page.getByRole('tab', { name: /^All \(\d+\)$/ }).click();
    await newOfflineDemo(page); // Leaving the resolved row removes it from the inbox.
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.locator('#sidebar-empty')).toHaveText('No unread sessions.');
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(dots).toBeHidden();
    expect(demo.children.size).toBe(2); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Switch session shares sidebar indicator, muted timestamp and styling for filtered-out rows', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const firstId = (await page.locator(sessions).getAttribute('id'))!;
    await newOfflineDemo(page);
    await page.getByRole('tab', { name: /Working/ }).click();
    await expect(page.locator('#conversation')).toBeHidden();
    await page.keyboard.press('Meta+t');
    await expect(page.locator('#palette-title')).toHaveText('Switch session');
    const options = page.locator('#palette-list [role=option]');
    await expect(options).toHaveCount(2);
    const option = options.nth(1), sidebar = page.locator(`#${firstId}`);
    await expect(option.locator('.session-row-text')).toHaveText((await sidebar.locator('.session-row-text').textContent())!);
    await expect(option.locator('.session-indicator')).toHaveAttribute('data-state', 'ready');
    await expect(option.locator('.session-indicator')).toHaveText('•');
    await expect(option.locator('small')).not.toContainText(/Ready|Current/);
    await expect(option).not.toHaveAttribute('title');
    for (const selector of ['.session-indicator', 'small']) {
      const properties = (node: Element) => { const css = getComputedStyle(node); return { color: css.color, fontSize: css.fontSize }; };
      expect(await option.locator(selector).evaluate(properties)).toEqual(await sidebar.locator(selector).evaluate(properties));
    }
    await option.click();
    await expect(page.locator(`#${firstId}`)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('tab', { name: /^All \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true');
    expect(demo.children.size).toBe(2); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Resume uses Switch row layout and typography while historical preview stays search-only', async ({ page }) => {
  const demo = await demoFixture(page, {}, [{ path: '/fixture/history.jsonl', sessionId: 'closed', name: 'Closed history '.repeat(40), preview: 'Find this hidden preview', modified: 1, lastUserMessageAt: Date.now() - 120_000 }]);
  try {
    await page.keyboard.press('Meta+t');
    const option = page.locator('#palette-list [role=option]');
    const geometry = (node: Element) => {
      const css = getComputedStyle(node);
      return { display: css.display, padding: css.padding, gap: css.gap, height: node.getBoundingClientRect().height };
    };
    const typography = (node: Element) => {
      const css = getComputedStyle(node);
      return { color: css.color, fontSize: css.fontSize, lineHeight: css.lineHeight };
    };
    const switchGeometry = await option.evaluate(geometry);
    const switchType = await option.locator('small').evaluate(typography);
    await page.keyboard.press('Escape'); await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette-title')).toHaveText('Resume session');
    await expect(option).toHaveCount(1);
    expect(await option.evaluate(geometry)).toEqual(switchGeometry);
    expect(await option.locator('small').evaluate(typography)).toEqual(switchType);
    await expect(option.locator('.session-indicator')).toHaveAttribute('data-state', 'inactive');
    await expect(option.locator('.session-row-badge')).toHaveCount(0);
    await expect(option.locator('time')).toContainText('2 minutes ago');
    await expect(option).not.toContainText('Find this hidden preview');
    await expect(option).not.toHaveAttribute('title');
    const label = option.locator('.session-row-label');
    expect(await label.evaluate(node => getComputedStyle(node).textOverflow)).toBe('ellipsis');
    expect(await label.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.locator('#palette-input').fill('hidden preview history.jsonl');
    await expect(option).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Unread updates in arrival order and retains a read selected session without changing open sessions', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const first = (await page.locator(sessions).getAttribute('id'))!;
    await newOfflineDemo(page);
    const second = (await page.locator(`${sessions}[aria-current="true"]`).getAttribute('id'))!;
    await page.locator(visible('prompt')).fill('Second session finishes first');
    await page.locator(visible('prompt')).press('Enter');
    await newOfflineDemo(page);
    const third = (await page.locator(`${sessions}[aria-current="true"]`).getAttribute('id'))!;
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.locator(`#${second}`)).toHaveAttribute('aria-label', /Unread/);
    const visibleRows = page.locator('#open-sessions .open-session:not([hidden]) .session-row');
    await expect(visibleRows).toHaveCount(1);
    await expect(page.locator('#sidebar-unread-count')).toHaveText('1');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('switch session');
    // Resume's directory detail can also match when the checkout is named switch-session-rows.
    await page.locator('#palette-list [role=option]').filter({ has: page.getByText('Switch session…', { exact: true }) }).click();
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(3);
    await page.locator('#palette-list [role=option]').nth(2).click(); // Oldest open session is last in All/Switch.
    await expect(page.getByRole('tab', { name: /^All \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true');
    await page.locator(visible('prompt')).fill('First session finishes later');
    await page.locator(visible('prompt')).press('Enter');
    await page.keyboard.press('Meta+Shift+]'); // First -> third in All's recency order, independent of filtering.
    await expect(page.locator(`#${third}`)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator(`#${first}`)).toHaveAttribute('aria-label', /Unread/);
    await expect(visibleRows).toHaveCount(2);
    expect(await visibleRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual([second, first]);
    await page.locator(`#${second}`).click();
    await expect(page.locator('#sidebar-unread-count')).toHaveText('1');
    await expect(page.locator(`#${second}`)).toBeVisible();
    expect(await visibleRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual([second, first]);
    await page.locator(`#${first}`).click();
    await expect(page.locator(`#${second}`)).toBeHidden();
    await expect(page.locator('#sidebar-unread-count')).toHaveText('0');
    await expect(page.locator(`#${first}`)).toBeVisible();
    await page.keyboard.press('Meta+Shift+]');
    await expect(page.getByRole('tab', { name: /^All \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`#${third}`)).toHaveAttribute('aria-current', 'true');
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(visibleRows).toHaveCount(0);
    await expect(page.locator('#sidebar-empty')).toHaveText('No unread sessions.');
    await expect(page.locator('#conversation')).toBeHidden();
    await page.getByRole('tab', { name: /^All \(\d+\)$/ }).click();
    expect(await visibleRows.evaluateAll(nodes => nodes.map(node => node.id))).toEqual([first, third, second]);
    expect(demo.children.size).toBe(3);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('sidebar hover spans the entire session row without splitting at Close', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await newOfflineDemo(page);
    await expect(page.locator(sessions)).toHaveCount(2);
    const rows = page.locator('#open-sessions .open-session');
    const inactive = rows.filter({ has: page.locator('.session-row[aria-current="false"]') });
    const selected = rows.filter({ has: page.locator('.session-row[aria-current="true"]') });
    const background = (node: Element) => getComputedStyle(node).backgroundColor;
    const selectedColor = await selected.evaluate(background);
    const idleColor = await inactive.evaluate(background);
    const closeColor = await inactive.locator('.session-close').evaluate(node => getComputedStyle(node).color);

    await inactive.locator('.session-row').hover();
    const hoverColor = await inactive.evaluate(background);
    expect(hoverColor).not.toBe(idleColor);
    await expect(inactive.locator('.session-row')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(inactive.locator('.session-close')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await inactive.locator('.session-close').hover();
    await expect(inactive).toHaveCSS('background-color', hoverColor);
    await expect(inactive.locator('.session-close')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await inactive.locator('.session-close').evaluate(node => getComputedStyle(node).color)).not.toBe(closeColor);

    await selected.locator('.session-row').hover();
    await expect(selected).toHaveCSS('background-color', selectedColor);
    await expect(selected.locator('.session-row')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const selectedCloseColor = await selected.locator('.session-close').evaluate(node => getComputedStyle(node).color);
    await selected.locator('.session-close').hover();
    await expect(selected).toHaveCSS('background-color', selectedColor);
    await expect(selected.locator('.session-close')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await selected.locator('.session-close').evaluate(node => getComputedStyle(node).color)).not.toBe(selectedCloseColor);
    // WebKit's platform Tab policy may skip buttons; explicitly focus after
    // keyboard input to verify the existing keyboard-focus treatment.
    await page.keyboard.press('Tab');
    await selected.locator('.session-close').focus();
    await expect(selected.locator('.session-close')).toBeFocused();
    await expect(selected.locator('.session-close')).toHaveCSS('outline-style', 'solid');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('Close reuses the latest connected session across filters with its draft and reading position intact', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const firstPanel = await page.locator('.session-view').getAttribute('id');
    const firstRow = page.locator(`${sessions}[aria-controls="${firstPanel}"]`);
    await newOfflineDemo(page);
    const secondPanel = await page.locator('.session-view:not([hidden])').getAttribute('id');
    const secondRow = page.locator(`${sessions}[aria-controls="${secondPanel}"]`);
    await newOfflineDemo(page);
    await firstRow.click();
    await demo.turn(1); await demo.turn(2);
    await page.locator(visible('transcript-viewport')).hover(); await page.mouse.wheel(0, -10000);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const reading = (await demo.metrics()).top;
    await page.locator(visible('prompt')).fill('Keep replacement draft');
    await secondRow.click();
    await page.locator(visible('prompt')).fill('Settle selected Working row');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('#sidebar-working-count')).toHaveText('1');
    await page.locator('#sidebar-working').click();
    await expect(page.locator('#sidebar-working-count')).toHaveText('0');
    await expect(page.locator('#conversation')).toBeVisible();
    const starts = demo.calls.filter(c => c.command === 'start_pi').length;
    await secondRow.locator('..').locator('.session-close').click();
    await expect(page.locator('#host-dialog')).toBeVisible(); await page.keyboard.press('Enter');
    await expect(page.locator(sessions)).toHaveCount(2);
    await expect(page.locator('#sidebar-all')).toHaveAttribute('aria-selected', 'true');
    await expect(firstRow).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep replacement draft');
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await expect.poll(async () => Math.abs((await demo.metrics()).top - reading)).toBeLessThanOrEqual(2);
    expect(demo.calls.filter(c => c.command === 'start_pi')).toHaveLength(starts);
    expect(demo.children.size).toBe(2); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('older-history reading position survives hiding a session during background streaming', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const firstRow = page.locator(`#${await page.locator(sessions).getAttribute('id')}`);
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const top = (await demo.metrics()).top;
    await page.locator(visible('prompt')).fill('Background while reading history');
    await page.locator(visible('prompt')).press('Enter');
    await newOfflineDemo(page);
    await expect(page.locator(sessions)).toHaveCount(2);
    await expect(firstRow).toHaveAttribute('aria-label', /Unread/);
    await firstRow.click();
    await expect.poll(async () => Math.abs((await demo.metrics()).top - top)).toBeLessThanOrEqual(2);
    expect((await demo.metrics()).gap).toBeGreaterThan(100);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('named-session palette step is compact, single-line and cancels without disturbing the live session', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep this unsent draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('new named session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('New named session');
    const name = page.getByRole('textbox', { name: 'Session name', exact: true });
    await expect(name).toBeFocused(); await expect(name).toHaveAttribute('type', 'text');
    await expect(page.locator('#host-dialog')).not.toBeVisible();
    for (const id of ['palette-list', 'palette-back', 'palette-refresh']) await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator('#palette-create')).toBeVisible();
    await expect(page.locator('#palette-create')).toBeDisabled();
    await name.fill('   '); await name.press('Enter');
    await expect(page.locator('#command-palette')).toBeVisible();
    await name.fill('A session name');
    await expect(page.locator('#palette-create')).toBeEnabled();
    const fieldBox = (await name.boundingBox())!, buttonBox = (await page.locator('#palette-create').boundingBox())!;
    expect(Math.abs(fieldBox.y + fieldBox.height / 2 - buttonBox.y - buttonBox.height / 2)).toBeLessThan(2);
    expect(buttonBox.x).toBeGreaterThan(fieldBox.x);
    await expect(page.locator('#palette-status')).toHaveText('Enter to create · Esc to cancel');
    await name.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Keep this unsent draft');
    expect(demo.calls.filter(c => c.command === 'start_pi')).toHaveLength(1);
    expect(demo.calls.some(c => (c.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    await page.keyboard.press('Meta+Shift+P');
    await expect(page.locator('#palette-input')).toHaveAttribute('role', 'combobox');
    await expect(page.locator('#palette-create')).toBeHidden();
    await page.keyboard.press('Escape');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('palette stays modal during streaming and Escape restores the untouched composer', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).fill('Stream while navigating');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await page.locator(visible('prompt')).fill('Keep this unsent draft');
    await page.keyboard.press('Meta+Shift+P');
    await expect(page.locator('#command-palette')).toBeVisible();
    await page.locator('#palette-input').fill('resume');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Resume session');
    await expect(page.locator('#palette-status')).toHaveText('No sessions yet.');
    await expect(page.locator(sessions)).toHaveAttribute('aria-label', /Ready/);
    await expect(page.locator('#palette-input')).toBeFocused();
    await page.locator('#palette-back').click();
    await expect(page.locator('#palette-title')).toHaveText('Commands');
    await expect(page.locator('#palette-input')).toHaveValue('resume');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Resume session');
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep this unsent draft');
    expect(demo.children.size).toBe(1);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
