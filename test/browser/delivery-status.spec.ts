import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

async function queuedStatus(page: Parameters<typeof demoFixture>[0]) {
  await page.evaluate(() => {
    const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
    channel.onmessage({ kind: 'rpc', value: { type: 'queue_update', steering: [], followUp: ['Pending fixture'] } });
  });
  const label = page.locator(visible('messages')).locator('.delivery-status-shimmer');
  await expect(label).toHaveText('Queued…');
  return label;
}

test('status shimmer sweeps left to right without changing text geometry and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const demo = await demoFixture(page);
  try {
    const label = await queuedStatus(page);
    await expect(label).toHaveCSS('animation-name', 'none');
    expect(await label.evaluate(node => getComputedStyle(node).color)).not.toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(label).toHaveCSS('animation-name', 'delivery-status-shimmer');
    const samples = await label.evaluate(node => {
      const animation = node.getAnimations()[0]; animation.pause();
      const sample = (time: number) => {
        animation.currentTime = time;
        const bounds = node.getBoundingClientRect();
        return { position: parseFloat(getComputedStyle(node).backgroundPositionX), width: bounds.width, height: bounds.height, top: bounds.top };
      };
      const first = sample(100), second = sample(1500);
      animation.play();
      return { first, second };
    });
    // A 300%-wide gradient moves from 100% to 0%, sweeping its bright band rightward.
    expect(samples.second.position).toBeLessThan(samples.first.position);
    expect(samples.second.width).toBe(samples.first.width);
    expect(samples.second.height).toBe(samples.first.height);
    expect(samples.second.top).toBe(samples.first.top);
    await expect(label).toHaveText('Queued…');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('status shimmer pauses in hidden sessions and resumes on return without replacing the label', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const label = await queuedStatus(page);
    await label.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'same-shimmer'; });
    const panel = await page.locator('.session-view').getAttribute('id');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('new temporary session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    const hiddenLabel = page.locator(`#${panel} .delivery-status-shimmer`);
    await expect(hiddenLabel).toHaveCSS('animation-play-state', 'paused');
    await page.locator(`#open-sessions .session-row[aria-controls="${panel}"]`).click();
    await expect(hiddenLabel).toHaveCSS('animation-play-state', 'running');
    await expect(hiddenLabel).toHaveAttribute('data-test-identity', 'same-shimmer');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
