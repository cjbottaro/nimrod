import { expect, test } from '@playwright/test';
import type { Packet } from '../../src/pi/transport';
import { demoFixture, visible } from './demo-fixture';

type RecencyFixture = Window & {
  __fixtureChannels: Record<string, { onmessage(packet: Packet): void }>;
  __heldReceipts: { count(): number; release(): void };
};

test('All reorders only on accepted sends, preserves its visible anchor at zoom and reveals explicit navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  const demo = await demoFixture(page);
  try {
    const first = (await page.locator('.session-row').getAttribute('id'))!;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Meta+Shift+P'); await page.locator('#palette-input').fill('new offline demo'); await page.locator('#palette-input').press('Enter');
      await expect(page.locator('.session-row')).toHaveCount(i + 2);
      await expect(page.locator(visible('send'))).toBeEnabled();
    }
    const target = (await page.locator('.session-row[aria-current="true"]').getAttribute('id'))!;
    const originalOrder = await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id));
    expect(originalOrder.at(-1)).toBe(target); // New/selection is not a send.
    // Hold only the last offline child's explicit prompt receipt; streaming and
    // completion still arrive, proving neither can stand in for acknowledgement.
    await page.evaluate(() => {
      const state = window as unknown as RecencyFixture;
      const channel = Object.values(state.__fixtureChannels).at(-1)!, original = channel.onmessage;
      const held: Packet[] = [];
      channel.onmessage = packet => {
        if (packet.kind === 'rpc' && packet.value.type === 'response' && packet.value.command === 'prompt') held.push(packet);
        else original(packet);
      };
      state.__heldReceipts = { count: () => held.length, release: () => { for (const packet of held.splice(0)) original(packet); } };
    });
    await page.locator(visible('prompt')).fill('Accepted later'); await page.locator(visible('prompt')).press('Enter');
    await page.waitForFunction(() => (window as unknown as RecencyFixture).__heldReceipts.count() === 1);
    await page.locator(`#${first}`).click();
    expect(await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id))).toEqual(originalOrder);
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my other session draft'); await prompt.focus();
    const sidebar = page.locator('#session-sidebar');
    const snapshot = await sidebar.evaluate(node => {
      node.scrollTop = 250;
      const bounds = node.getBoundingClientRect();
      const row = [...node.querySelectorAll<HTMLElement>('.open-session')].find(row => row.getBoundingClientRect().top >= bounds.top)!;
      return { id: row.querySelector('.session-row')!.id, top: row.getBoundingClientRect().top, scroll: node.scrollTop };
    });
    expect(snapshot.scroll).toBeGreaterThan(100);
    await expect(page.locator(`#${target}`)).toHaveAttribute('aria-label', /Completed/);
    expect(await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id))).toEqual(originalOrder);
    await page.evaluate(() => (window as unknown as RecencyFixture).__heldReceipts.release());
    await expect(page.locator('.session-row').first()).toHaveAttribute('id', target);
    await expect.poll(async () => Math.abs((await page.locator(`#${snapshot.id}`).evaluate(row => row.parentElement!.getBoundingClientRect().top)) - snapshot.top)).toBeLessThanOrEqual(2);
    expect(await sidebar.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator(`#${first}`)).toHaveAttribute('aria-current', 'true');
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Keep my other session draft');

    // Clicking a visible row leaves the entire order and scroll position intact.
    const beforeClick = await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id));
    const scroll = await sidebar.evaluate(node => node.scrollTop);
    await page.locator(`#${snapshot.id}`).click();
    expect(await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id))).toEqual(beforeClick);
    expect(Math.abs(await sidebar.evaluate(node => node.scrollTop) - scroll)).toBeLessThanOrEqual(2);
    // Rename is metadata: even its accepted receipt must preserve order/scroll.
    await page.locator(visible('prompt')).fill('/name Renamed without activity'); await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await expect(page.locator(`#${snapshot.id}`)).toHaveAttribute('aria-label', /Renamed without activity/);
    expect(await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.id))).toEqual(beforeClick);
    expect(Math.abs(await sidebar.evaluate(node => node.scrollTop) - scroll)).toBeLessThanOrEqual(2);
    // A normal accepted prompt, unlike selection or rename, moves it to the top.
    await page.locator(visible('prompt')).fill('Now actually use this session'); await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('.session-row').first()).toHaveAttribute('id', snapshot.id);
    expect(await sidebar.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    await page.getByRole('tab', { name: /Needs attention/ }).click();
    await page.getByRole('tab', { name: 'All', exact: true }).click();
    const selectedBounds = await page.locator(`#${snapshot.id}`).boundingBox(), bounds = await sidebar.boundingBox();
    expect(selectedBounds!.y).toBeGreaterThanOrEqual(bounds!.y - 2);
    expect(selectedBounds!.y + selectedBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 2);
    expect(demo.children.size).toBe(15);
    expect(demo.calls.filter(call => call.command === 'stop_pi')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
