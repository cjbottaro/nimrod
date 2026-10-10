import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

for (const readingHistory of [false, true]) test(`steering reconciles without duplicates and preserves ${readingHistory ? 'history reading' : 'bottom follow'}`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    }
    const readingTop = (await demo.metrics()).top;
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Start work before steering'); await prompt.press('Enter');
    await expect(page.locator(visible('keyboard-hint'))).toContainText('Enter to steer');
    await expect(prompt).toHaveValue('');
    await prompt.fill('Change direction now'); await prompt.press('Enter');
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Change direction now' });
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveText('Pending steering');
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'pending-steer'; });
    await expect(page.locator(visible('queue-activity'))).not.toContainText('Change direction now');
    await expect(prompt).toHaveValue('');
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await expect(turn).toHaveAttribute('data-test-identity', 'pending-steer');
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - readingTop)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
