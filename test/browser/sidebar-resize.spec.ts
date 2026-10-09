import { expect, test, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const widthKey = `nimrod.sidebar.width:${process.cwd()}`;
const sidebarWidth = (page: Page) => page.locator('#session-sidebar').evaluate(node => (node as HTMLElement).offsetWidth);
async function drag(page: Page, delta: number, release = true) {
  const bounds = (await page.locator('#sidebar-resizer').boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + delta, y, { steps: 6 });
  if (release) await page.mouse.up();
}

test('sidebar drag uses layout pixels at zoom, persists/restores app state and keeps draft/disclosure/follow', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const demo = await demoFixture(page, { [widthKey]: 340 });
  try {
    await expect.poll(() => sidebarWidth(page)).toBe(340);
    await demo.turn(1);
    const panel = (await page.locator('.session-view').getAttribute('id'))!;
    const tool = page.locator(`#${panel} .tool-card`).first(); await tool.locator('summary').first().click();
    const prompt = page.locator(visible('prompt')); await prompt.fill('Preserved draft'); await prompt.focus();
    await drag(page, 100); // 100 physical/fixture pixels at 125% = 80 layout pixels.
    await expect.poll(() => sidebarWidth(page)).toBe(420);
    await expect.poll(() => demo.state()[widthKey]).toBe(420);
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Preserved draft'); await expect(tool).toHaveAttribute('open', '');
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(await page.locator('.session-view').getAttribute('id')).toBe(panel);
    expect(demo.children.size).toBe(1); expect(demo.calls.filter(call => call.command === 'start_pi')).toHaveLength(1);

    await drag(page, -75, false); await page.keyboard.press('Escape'); await page.mouse.up();
    await expect.poll(() => sidebarWidth(page)).toBe(420); expect(demo.state()[widthKey]).toBe(420);
    await expect(page.locator('body')).not.toHaveClass(/resizing-sidebar/);
    await page.locator('#toggle-sidebar').click(); await expect(page.locator('#sidebar-resizer')).toBeHidden();
    await page.locator('#toggle-sidebar').click(); await expect.poll(() => sidebarWidth(page)).toBe(420);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(() => sidebarWidth(page)).toBeLessThan(420);
    expect(demo.state()[widthKey]).toBe(420);
    await page.setViewportSize({ width: 1200, height: 800 }); await expect.poll(() => sidebarWidth(page)).toBe(420);
    expect(demo.errors).toEqual([]);

    const reopened = await context.newPage(); await reopened.setViewportSize({ width: 1200, height: 800 });
    const restored = await demoFixture(reopened, demo.state());
    try { await expect.poll(() => sidebarWidth(reopened)).toBe(420); expect(restored.errors).toEqual([]); }
    finally { await restored.close(); await reopened.close(); }
  } finally { await demo.close(); }
});

test('sidebar separator supports keyboard/reset, remains on its edge in narrow overlay and respects modal focus', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const separator = page.getByRole('separator', { name: 'Resize session sidebar' });
    await separator.focus(); await separator.press('ArrowRight'); await expect.poll(() => sidebarWidth(page)).toBe(270);
    await separator.press('Shift+ArrowRight'); await expect.poll(() => sidebarWidth(page)).toBe(320);
    await separator.press('Home'); await expect.poll(() => sidebarWidth(page)).toBe(180);
    await separator.press('End');
    await expect.poll(async () => String(await sidebarWidth(page))).toBe(await separator.getAttribute('aria-valuemax'));
    await expect(separator).toBeFocused();
    await separator.dblclick(); await expect.poll(() => sidebarWidth(page)).toBe(260);
    await expect.poll(() => demo.state()[widthKey]).toBe(null);
    await page.setViewportSize({ width: 500, height: 700 });
    await expect.poll(() => sidebarWidth(page)).toBe(250);
    const handle = (await separator.boundingBox())!, sidebar = (await page.locator('#session-sidebar').boundingBox())!;
    expect(Math.abs(handle.x + handle.width / 2 - sidebar.x - sidebar.width)).toBeLessThanOrEqual(2);
    await drag(page, 500); // Pointer capture terminates even beyond the viewport.
    const layoutWidth = await page.locator('#workspace-layout').evaluate(node => node.clientWidth);
    await expect.poll(() => sidebarWidth(page)).toBe(Math.min(520, layoutWidth - 48));
    const retained = demo.state()[widthKey];
    await page.locator('#open-settings').click(); await expect(page.locator('#settings-page')).toBeVisible();
    await page.keyboard.press('ArrowLeft'); expect(demo.state()[widthKey]).toBe(retained);
    await page.keyboard.press('Escape');
    expect(demo.children.size).toBe(1); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('sidebar resize leaves older transcript reading paused during subsequent streaming', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const pane = page.locator(visible('transcript-viewport'));
    await pane.hover(); await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const panel = (await page.locator('.session-view').getAttribute('id'))!;
    const prompt = page.locator(visible('prompt')); await prompt.fill('Continue without following'); await prompt.focus();
    await drag(page, 100);
    await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Continue without following');
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(60);
    await prompt.press('Enter'); await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(60);
    await page.waitForFunction(() => Object.values((window as unknown as { __fixtureChannels: Record<string, unknown>; __fixtureSettled: number }).__fixtureChannels).length === 1 && (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    expect((await demo.metrics()).gap).toBeGreaterThan(60);
    expect(await page.locator('.session-view').getAttribute('id')).toBe(panel);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
