import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

for (const mode of ['whenIdle', 'always', 'never'] as const)
for (const readingHistory of [false, true]) test(`idle send previews before dispatch with ${mode} and ${readingHistory ? 'history reading' : 'bottom follow'}`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    }
    await demo.editPreferences(JSON.stringify({ 'appearance.autoFollowAfterSending': mode }));
    await expect(page.locator('#send-auto-follow')).toHaveValue(mode);
    const preserveReading = readingHistory && mode === 'never';
    const readingTop = (await demo.metrics()).top;
    // Hold native dispatch: the renderer must show a turn before any Pi event/receipt.
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __releasePrompt?: () => void };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const gate = new Promise<void>(resolve => { state.__releasePrompt = resolve; });
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'write_pi' && (args?.message as { type?: string })?.type === 'prompt') await gate;
        return invoke(command, args);
      };
    });
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Immediate idle message'); await prompt.press('Enter');
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Immediate idle message' });
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'idle-preview'; });
    await expect(prompt).toHaveValue(''); await expect(prompt).toBeFocused();
    if (preserveReading) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await prompt.fill('Newer draft');
    await page.evaluate(() => (window as unknown as { __releasePrompt: () => void }).__releasePrompt());
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await expect(turn).toHaveAttribute('data-test-identity', 'idle-preview');
    await expect(prompt).toHaveValue('Newer draft'); await expect(prompt).toBeFocused();
    if (preserveReading) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

for (const readingHistory of [false, true]) test(`steering reconciles without duplicates and preserves ${readingHistory ? 'history reading' : 'bottom follow'}`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    }
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Start work before steering'); await prompt.press('Enter');
    await expect(page.locator(visible('keyboard-hint'))).toContainText('Enter to steer');
    await expect(prompt).toHaveValue('');
    // Idle Send now follows by default; choose history reading again during work.
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    }
    const readingTop = (await demo.metrics()).top;
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __releaseSteer?: () => void };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const gate = new Promise<void>(resolve => { state.__releaseSteer = resolve; });
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'write_pi' && (args?.message as { type?: string })?.type === 'prompt') await gate;
        return invoke(command, args);
      };
    });
    await prompt.fill('Change direction now'); await prompt.press('Enter');
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Change direction now' });
    await expect(turn).toHaveCount(1);
    const label = turn.locator('.delivery-status-shimmer');
    await expect(label).toHaveText('Steering');
    const position = await label.evaluate(node => getComputedStyle(node).backgroundPositionX);
    await expect.poll(() => label.evaluate(node => getComputedStyle(node).backgroundPositionX)).not.toBe(position);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'pending-steer'; });
    await expect(page.locator(visible('queue-activity'))).not.toContainText('Change direction now');
    await expect(prompt).toHaveValue('');
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.evaluate(() => (window as unknown as { __releaseSteer: () => void }).__releaseSteer());
    await expect(turn).toHaveAttribute('data-test-identity', 'pending-steer');
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await expect(turn).toHaveAttribute('data-test-identity', 'pending-steer');
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
