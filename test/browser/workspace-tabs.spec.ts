import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const sessions = '#open-sessions .session-row';

async function newOfflineDemo(page: Parameters<typeof demoFixture>[0]): Promise<void> {
  await page.keyboard.press('Meta+Shift+P');
  await page.locator('#palette-input').fill('new offline demo');
  await page.locator('#palette-input').press('Enter');
}

test('sidebar sessions keep independent drafts and a background agent live without a tab strip', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await expect(page.locator('#session-sidebar')).toBeVisible();
    await expect(page.locator(sessions)).toHaveCount(1);
    await expect(page.locator(sessions)).not.toHaveAttribute('title');
    await expect(page.locator('#sidebar-workspace, #sidebar-directory, #open-section, .sidebar-actions')).toHaveCount(0);
    await expect(page.locator('#session-tabs, #all-section')).toHaveCount(0);
    await demo.turn(1);
    const firstPanel = await page.locator('.session-view').getAttribute('id');
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
    await expect(page.locator(sessions).nth(0)).toHaveAttribute('aria-label', /Working/);
    await page.locator(sessions).nth(1).click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Second session draft');
    await expect(page.locator(sessions).nth(0)).toHaveAttribute('aria-label', /Completed/);
    expect(demo.children.size).toBe(2);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    await page.locator(sessions).nth(0).click();
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

test('sidebar hover spans the entire session row without splitting at Close', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await newOfflineDemo(page);
    await expect(page.locator(sessions)).toHaveCount(2);
    const rows = page.locator('#open-sessions .open-session');
    const inactive = rows.nth(0);
    const selected = rows.nth(1);
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

test('older-history reading position survives hiding a session during background streaming', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const top = (await demo.metrics()).top;
    await page.locator(visible('prompt')).fill('Background while reading history');
    await page.locator(visible('prompt')).press('Enter');
    await newOfflineDemo(page);
    await expect(page.locator(sessions)).toHaveCount(2);
    await expect(page.locator(sessions).nth(0)).toHaveAttribute('aria-label', /Completed/);
    await page.locator(sessions).nth(0).click();
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
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette-title')).toHaveText('Commands');
    await expect(page.locator('#palette-input')).toHaveValue('resume');
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep this unsent draft');
    expect(demo.children.size).toBe(1);
    expect(demo.calls.filter(c => c.command === 'stop_pi')).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
