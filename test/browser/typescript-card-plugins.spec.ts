import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { demoFixture, visible } from './demo-fixture';

const manifest = JSON.stringify({ apiVersion: 2, id: 'example.command-summary', tools: ['bash'], entry: 'command-summary.js' });
async function packages() {
  const result = await build({ entryPoints: ['examples/card-plugins/command-summary/plugin.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  return { 'command-summary.json': manifest, 'command-summary.js': result.outputFiles[0].text };
}

test('trusted TypeScript example loads as real ESM under production-shaped CSP, retains custom DOM during streaming and uses host Copy', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":["command-summary.json"]}', packages: await packages() }, { enforceCsp: true });
  try {
    await page.locator(visible('prompt')).fill('Offline executable plugin proof'); await page.locator(visible('prompt')).press('Enter');
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) }).first();
    await expect(card).toBeVisible(); await card.locator('summary').first().click();
    const note = card.getByRole('textbox', { name: 'Local card note' }); await note.fill('keep my local state');
    await note.evaluate(node => node.setAttribute('data-fixture-node', 'retained'));
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 1);
    await expect(note).toHaveValue('keep my local state'); await expect(note).toHaveAttribute('data-fixture-node', 'retained'); await expect(note).toBeFocused();
    await expect(card.locator('.tool-raw-output')).toContainText('Fixture complete');
    const copy = card.getByRole('button', { name: 'Copy command' }); await copy.focus(); await copy.press('Enter');
    await expect(card.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible(); await expect(copy).toBeFocused();
    expect(demo.calls.filter(call => call.command === 'read_card_plugin_module')).toHaveLength(1);
    expect(demo.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)?.args.text).toBe('demo: stream fixture output (not executed)');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('executable trust is explicit and revocation stops managed controls without sending prompts', async ({ page }) => {
  const source = await packages();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["command-summary.json"]}', packages: source }, { enforceCsp: true });
  try {
    expect(demo.calls.filter(call => call.command === 'read_card_plugin_module')).toHaveLength(0);
    await page.locator('#open-settings').click(); await expect(page.locator('#card-plugin-error')).toContainText('explicit cards.trustedPlugins'); await page.locator('#settings-back').click();
    await demo.editPreferences('{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":["command-summary.json"]}');
    await expect.poll(() => demo.calls.filter(call => call.command === 'read_card_plugin_module').length).toBe(1);
    await demo.turn(1);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) }).first();
    await card.locator('summary').first().click(); await expect(card.getByRole('button', { name: 'Copy command' })).toBeVisible();
    await demo.editPreferences('{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":[]}');
    await card.getByRole('button', { name: 'Copy command' }).click();
    await expect(card.getByRole('button', { name: 'Copy command' })).toHaveCount(0);
    await expect(card.locator('.card-plugin-body')).toContainText('Fixture complete');
    expect(demo.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text')).toHaveLength(0);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('managed asynchronous body growth preserves bottom follow and older-history reading without focus changes', async ({ page }) => {
  const source = `export default { apiVersion: 2, id: 'example.command-summary', supports: () => true, mount(ctx) {
    const title = ctx.document.createElement('span'); title.className = 'tool-card-title'; title.textContent = 'bash'; ctx.summary.append(title);
    const button = ctx.document.createElement('button'); button.textContent = 'Grow body'; ctx.body.append(button);
    ctx.on(button, 'click', async () => { await Promise.resolve(); ctx.mutate(() => {
      const block = ctx.document.createElement('div'); block.style.height = '1000px'; block.textContent = 'Fixture growth'; ctx.body.append(block);
    }); }); return { update() {}, dispose() {} };
  } };`;
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":["command-summary.json"]}',
    packages: { 'command-summary.json': manifest, 'command-summary.js': source } }, { enforceCsp: true });
  try {
    await demo.turn(1); await demo.turn(2);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) }).last();
    await card.locator('summary').first().click();
    const pane = page.locator(visible('transcript-viewport'));
    // Let disclosure's toggle/reveal finish before explicit native bottom navigation.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const prompt = page.locator(visible('prompt')); await prompt.focus();
    await pane.hover({ position: { x: 20, y: 30 } }); await page.mouse.wheel(0, 10000);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await card.getByRole('button', { name: 'Grow body' }).evaluate(node => (node as HTMLButtonElement).click());
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2); await expect(prompt).toBeFocused();
    await pane.hover({ position: { x: 20, y: 30 } }); await page.mouse.wheel(0, -180);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const reading = (await demo.metrics()).top;
    await card.getByRole('button', { name: 'Grow body' }).evaluate(node => (node as HTMLButtonElement).click());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(Math.abs((await demo.metrics()).top - reading)).toBeLessThanOrEqual(2); await expect(prompt).toBeFocused();
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('trusted module initialization exception is reported without preventing ordinary offline rendering', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":["command-summary.json"]}',
    packages: { 'command-summary.json': manifest, 'command-summary.js': 'throw new Error("Fixture module initialization failed"); export default {};' } }, { enforceCsp: true });
  try {
    await demo.turn(1); await expect(page.locator(visible('messages'))).toContainText('Fixture complete');
    await page.locator('#open-settings').click(); await expect(page.locator('#card-plugin-error')).toContainText('Fixture module initialization failed');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('trusted incompatible module falls back to raw historical data without preventing the offline app from running', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["command-summary.json"],"cards.trustedPlugins":["command-summary.json"],"cards.renderers":{"bash":"example.command-summary"}}',
    packages: { 'command-summary.json': manifest, 'command-summary.js': 'export default { apiVersion: 2, id: "example.wrong", supports() { return true; }, mount() {} };' } }, { enforceCsp: true });
  try {
    await demo.turn(1);
    await expect(page.locator(visible('messages'))).toContainText('Fixture complete');
    await page.locator('#open-settings').click(); await expect(page.locator('#card-plugin-error')).toContainText('does not match manifest');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
