import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import type { PerformanceReport } from '../../src/performance-diagnostics';

// Offline WebKit, mock native report storage. No user's app/session or provider work.
test('opt-in capture retains the session, reading position and draft; failures/cancellation use existing surfaces', async ({ page }) => {
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
    await prompt.focus();
    const primary = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
    await page.keyboard.press(primary + '+,'); await page.locator('#settings-category-diagnostics').click();
    await expect(page.locator('#performance-mode')).toHaveValue('off');
    await expect(page.locator('#performance-capture')).toBeDisabled();
    await page.locator('#performance-mode').selectOption('on');
    await expect(page.locator('#performance-capture')).toBeEnabled();
    await page.locator('#settings-back').click(); await expect(prompt).toBeFocused();
    await page.keyboard.press(primary + '+Shift+P');
    await page.locator('#palette-input').fill('Capture performance report');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(prompt).toBeFocused();
    await expect.poll(() => fixture.calls.filter(c => c.command === 'write_performance_report').length, { timeout: 10_000 }).toBe(1);
    const report = fixture.calls.find(c => c.command === 'write_performance_report')!.args.report as unknown as PerformanceReport;
    expect(report.samples.length).toBeGreaterThan(0);
    expect(report.endMs - report.markerMs).toBeGreaterThanOrEqual(4900);
    expect(JSON.stringify(report)).not.toMatch(/Private draft|never record this|\/sessions|fixture-only/);
    expect(report.environment.fieldSizing).toBe(await page.evaluate(() => CSS.supports('field-sizing', 'content')));
    await expect(prompt).toHaveValue('Private draft: never record this text'); await expect(prompt).toBeFocused();
    expect(await page.locator('.session-view:not([hidden])').getAttribute('id')).toBe(viewId);
    expect(await card.evaluate(node => (node as HTMLDetailsElement).open)).toBe(open);
    expect(await viewport.evaluate(node => node.scrollTop)).toBe(0);
    expect(fixture.calls.filter(c => c.command === 'start_pi').length).toBe(starts);
    expect(fixture.calls.filter(c => c.command === 'write_pi' && (c.args.message as { type?: string })?.type === 'prompt').length).toBe(sends);
    await page.locator('#open-settings').click();
    await expect(page.locator('#performance-status')).toContainText('Report saved: /fixture/');
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } };
      const original = state.__TAURI_INTERNALS__.invoke;
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'write_performance_report') throw new Error('fixture report disk full');
        return original(command, args);
      };
    });
    await page.locator('#performance-capture').click();
    await expect(page.locator('#performance-capture')).toBeDisabled();
    await expect(page.locator('#application-notices')).toContainText('fixture report disk full', { timeout: 10_000 });
    await expect(page.locator('#performance-status')).toBeEmpty();
    await expect(page.locator('#performance-capture')).toBeEnabled();
    await page.locator('#performance-capture').click();
    await page.locator('#performance-mode').selectOption('off');
    await expect(page.locator('#performance-capture')).toBeDisabled();
    await expect(page.locator('#performance-status')).toContainText('off');
    await page.locator('#settings-back').click();
    await expect(prompt).toHaveValue('Private draft: never record this text');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
