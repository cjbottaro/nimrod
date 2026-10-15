import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import type { PerformanceReport } from '../../src/performance-diagnostics';

// Offline WebKit, separate mocked Settings window and local report storage.
test('global opt-in captures only the project and preserves reading, draft and disclosure state', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1); await fixture.turn(2);
    const prompt = page.locator(visible('prompt'));
    const viewport = page.locator(visible('transcript-viewport'));
    await prompt.fill('Private draft: never record this text');
    const card = page.locator('.session-view:not([hidden]) details.tool-card').first();
    await card.locator('summary').first().click();
    const open = await card.evaluate(node => (node as HTMLDetailsElement).open);
    await viewport.evaluate(node => { node.scrollTop = 0; });
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBe(0);
    const viewId = await page.locator('.session-view:not([hidden])').getAttribute('id');
    const starts = fixture.calls.filter(c => c.command === 'start_pi').length;
    const sends = fixture.calls.filter(c => c.command === 'write_pi' && (c.args.message as { type?: string })?.type === 'prompt').length;
    const primary = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
    await prompt.focus();
    await page.keyboard.press(primary + '+,');
    const settingsPage = await fixture.settingsWindow();
    await settingsPage.locator('#settings-category-diagnostics').click();
    await expect(settingsPage.locator('#performance-mode')).toHaveValue('off');
    await expect(settingsPage.locator('#performance-capture')).toBeHidden();
    await settingsPage.locator('#performance-mode').selectOption('on');
    await settingsPage.locator('#settings-back').click();
    await expect(prompt).toBeFocused();
    // Local fixture packet exercises the ordered event-to-shell probes without a prompt.
    await page.evaluate(() => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      Object.values(channels)[0].onmessage({ kind: 'rpc', value: { type: 'agent_start' } });
    });
    async function capture() {
      await page.keyboard.press(primary + '+Shift+P');
      await page.locator('#palette-input').fill('Capture performance report');
      await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#command-palette')).not.toBeVisible();
    }
    await capture();
    await expect(prompt).toBeFocused();
    await expect.poll(() => fixture.calls.filter(c => c.command === 'write_performance_report').length, { timeout: 10_000 }).toBe(1);
    const report = fixture.calls.find(c => c.command === 'write_performance_report')!.args.report as unknown as PerformanceReport;
    expect(report.version).toBe(2);
    expect(report.samples.length).toBeGreaterThan(0);
    expect(report.environment.appearance).toBeDefined();
    expect(report.work.length).toBeGreaterThan(0);
    expect(report.work.every(sample => sample.selfMs <= sample.totalMs)).toBe(true);
    expect(report.endMs - report.markerMs).toBeGreaterThanOrEqual(4900);
    expect(JSON.stringify(report)).not.toMatch(/Private draft|never record this|\/sessions|fixture-only/);
    expect(report.environment.fieldSizing).toBe(await page.evaluate(() => CSS.supports('field-sizing', 'content')));
    await expect(page.locator('#application-notices')).toContainText('Report saved: /fixture/');
    await expect(page.locator('#application-notices')).toContainText('Path copied to clipboard');
    expect(fixture.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)?.args.text).toBe('/fixture/.local/state/nimrod/performance-captures/2026-10-14_12-00-00.000Z.json');
    await expect(prompt).toHaveValue('Private draft: never record this text'); await expect(prompt).toBeFocused();
    expect(await page.locator('.session-view:not([hidden])').getAttribute('id')).toBe(viewId);
    expect(await card.evaluate(node => (node as HTMLDetailsElement).open)).toBe(open);
    expect(await viewport.evaluate(node => node.scrollTop)).toBe(0);
    expect(fixture.calls.filter(c => c.command === 'start_pi').length).toBe(starts);
    expect(fixture.calls.filter(c => c.command === 'write_pi' && (c.args.message as { type?: string })?.type === 'prompt').length).toBe(sends);
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } };
      const original = state.__TAURI_INTERNALS__.invoke;
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'write_performance_report') throw new Error('fixture report disk full');
        return original(command, args);
      };
    });
    await capture();
    await expect(page.locator('#application-notices')).toContainText('fixture report disk full', { timeout: 10_000 });
    await capture();
    const reopened = await fixture.settingsWindow();
    await reopened.locator('#settings-category-diagnostics').click();
    await reopened.locator('#performance-mode').selectOption('off');
    await expect(page.locator('#application-notices')).not.toContainText('Capturing five more seconds');
    await reopened.locator('#settings-back').click();
    await expect(prompt).toHaveValue('Private draft: never record this text');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
