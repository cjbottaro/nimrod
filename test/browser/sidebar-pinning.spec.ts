import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('pinning prefers list top, minimally reveals a deep pin, and unpinning preserves reading at CSS zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  const demo = await demoFixture(page);
  try {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Meta+Shift+P'); await page.locator('#palette-input').fill('new temporary session'); await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#open-sessions .session-row')).toHaveCount(i + 2);
      await expect(page.locator(visible('send'))).toBeEnabled();
    }
    const ids = await page.locator('#open-sessions .session-row').evaluateAll(rows => rows.map(row => row.id));
    const target = page.locator(`#${ids.at(-1)}`).locator('..');
    const sidebar = page.locator('#sidebar-session-panel'), prompt = page.locator(visible('prompt'));
    await prompt.fill('Retain my draft'); await prompt.focus();
    const selected = await page.locator('.session-row[aria-current=true]').getAttribute('id');
    const starts = demo.calls.filter(call => call.command === 'start_pi').length;
    // Dispatch through the real button handler without Playwright scrolling or
    // focusing an offscreen row before the application handles the pin intent.
    await sidebar.evaluate(node => { node.scrollTop = 200; });
    await target.locator('.session-pin').evaluate(button => (button as HTMLButtonElement).click());
    expect(await sidebar.evaluate(node => node.scrollTop)).toBe(0);
    await target.locator('.session-pin').evaluate(button => (button as HTMLButtonElement).click());
    for (const id of ids.slice(0, 6)) await page.locator(`#${id}`).locator('..').locator('.session-pin').evaluate(button => (button as HTMLButtonElement).click());
    await sidebar.evaluate(node => { node.scrollTop = 200; });
    await target.locator('.session-pin').evaluate(button => (button as HTMLButtonElement).click());
    expect(await sidebar.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const bounds = (await sidebar.boundingBox())!, row = (await target.boundingBox())!;
    expect(row.y).toBeGreaterThanOrEqual(bounds.y - 2);
    expect(Math.abs(row.y + row.height - bounds.y - bounds.height)).toBeLessThanOrEqual(2);
    const before = await sidebar.evaluate(node => {
      node.scrollTop = 150;
      const bounds = node.getBoundingClientRect();
      const anchor = [...node.querySelectorAll<HTMLElement>('.open-session')].find(row => row.getBoundingClientRect().top >= bounds.top)!;
      return { id: anchor.querySelector('.session-row')!.id, top: anchor.getBoundingClientRect().top };
    });
    await target.locator('.session-pin').evaluate(button => (button as HTMLButtonElement).click());
    expect(await sidebar.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const after = await page.locator(`#${before.id}`).evaluate(row => row.parentElement!.getBoundingClientRect().top);
    expect(Math.abs(after - before.top)).toBeLessThanOrEqual(2);
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Retain my draft');
    await expect(page.locator('.session-row[aria-current=true]')).toHaveAttribute('id', selected!);
    expect(demo.calls.filter(call => call.command === 'start_pi').length).toBe(starts);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('sidebar pin and Close reveal on hover/focus; pin remains visible with retained row and conversation', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const row = page.locator('#open-sessions .open-session').first();
    const pin = row.locator('.session-pin'), close = row.locator('.session-close');
    await expect(row.locator('.session-delete')).toHaveCount(0);
    await pin.focus(); await expect(pin).toHaveCSS('opacity', '1'); await expect(close).toHaveCSS('opacity', '1');
    expect(await pin.evaluate(button => button.nextElementSibling?.className)).toBe('session-close');
    const separator = page.getByRole('separator', { name: 'Resize session sidebar' }); await separator.focus(); await separator.press('Home');
    await row.hover();
    const pinBox = (await pin.boundingBox())!, closeBox = (await close.boundingBox())!, rowBox = (await row.boundingBox())!;
    expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(closeBox.x);
    expect(Math.abs(pinBox.y - closeBox.y)).toBeLessThanOrEqual(1);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my draft');
    const panel = await page.locator('.session-view:not([hidden])').getAttribute('id');
    await row.hover(); await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await prompt.focus(); await prompt.hover();
    await expect(pin).toHaveCSS('opacity', '1'); await expect(close).toHaveCSS('opacity', '0');
    await expect(prompt).toHaveValue('Keep my draft');
    await expect(page.locator('.session-view:not([hidden])')).toHaveAttribute('id', panel!);
    await row.click({ button: 'right' });
    await expect.poll(() => demo.calls.filter(call => call.command === 'popup_session_menu').length).toBe(1);
    const options = demo.calls.find(call => call.command === 'popup_session_menu')!.args.options as Record<string, unknown>;
    expect(options.pinLabel).toBe('Unpin session'); expect(options.deleteEnabled).toBe(false);
    expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
