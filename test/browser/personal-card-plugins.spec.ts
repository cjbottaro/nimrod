import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { demoFixture, visible } from './demo-fixture';
import type { PersonalBundles } from '../../src/pi/card-plugins/catalog';

function compilerFixture() {
  let source = readFileSync('examples/card-plugins/command-summary/plugin.ts', 'utf8');
  let previous = ''; let bundle = ''; let builds = 0;
  return {
    edit() { source = source.replace("copy.textContent = 'Copy command'", "copy.textContent = 'Copy updated command'"); },
    builds: () => builds,
    async load(): Promise<PersonalBundles> {
      const cacheHit = previous === source;
      if (!cacheHit) {
        const result = await build({ stdin: { contents: source, loader: 'ts', resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
        bundle = result.outputFiles[0].text; previous = source; builds++;
      }
      return { entries: ['command-summary/index.ts'], plugins: [{ entry: 'command-summary/index.ts', source: bundle, cacheHit }], warnings: [] };
    },
  };
}

test('personal TS is loaded without manifests/settings and reload reuses cache then applies edits only to new cards', async ({ page }) => {
  const compiler = compilerFixture();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: () => compiler.load() }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toContainText('1 personal'); await demo.turn(1);
    const cards = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) });
    const first = cards.first(); await first.locator('summary').first().click();
    const note = first.getByRole('textbox', { name: 'Local card note' }); await note.fill('keep inspected state');
    await note.evaluate(node => node.setAttribute('data-fixture-identity', 'same'));
    const prompt = page.locator(visible('prompt')); await prompt.fill('untouched draft'); await prompt.focus();
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    async function reload() {
      await page.keyboard.press(`${primary}+Shift+P`); await page.locator('#palette-input').fill('Reload card plugins'); await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#command-palette')).not.toHaveAttribute('open', '');
    }
    const stops = demo.calls.filter(call => call.command === 'start_pi' || call.command === 'stop_pi').length;
    await reload(); await expect(page.locator('#card-plugin-status')).toContainText('1 cached'); expect(compiler.builds()).toBe(1);
    await expect(prompt).toHaveValue('untouched draft'); await expect(prompt).toBeFocused();
    await expect(note).toHaveValue('keep inspected state'); await expect(note).toHaveAttribute('data-fixture-identity', 'same');
    compiler.edit(); await reload();
    await expect.poll(() => compiler.builds()).toBe(2); await expect(page.locator('#card-plugin-status')).toContainText('0 cached');
    await expect(first.getByRole('button', { name: 'Copy command', exact: true })).toBeVisible();
    expect(demo.calls.filter(call => call.command === 'start_pi' || call.command === 'stop_pi')).toHaveLength(stops);
    await demo.turn(2); const next = cards.nth(1); await next.locator('summary').first().click();
    await expect(next.getByRole('button', { name: 'Copy updated command' })).toBeVisible(); await expect(note).toHaveValue('keep inspected state');
    expect(demo.calls.some(call => call.command === 'read_card_plugin' || call.command === 'read_card_plugin_module')).toBe(false); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('slow personal compilation does not block boot/drafts and completion does not replace already-mounted cards', async ({ page }) => {
  const compiler = compilerFixture(); const prepared = await compiler.load(); let finish!: (value: PersonalBundles) => void;
  const pending = new Promise<PersonalBundles>(resolve => { finish = resolve; });
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: () => pending }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toHaveText('Loading card plugins…'); await demo.turn(1);
    const first = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) }).first();
    await first.evaluate(node => node.setAttribute('data-fixture-card', 'retained'));
    const prompt = page.locator(visible('prompt')); await prompt.fill('keep this draft'); await prompt.focus();
    finish(prepared); await expect(page.locator('#card-plugin-status')).toContainText('1 personal');
    await expect(prompt).toHaveValue('keep this draft'); await expect(prompt).toBeFocused();
    await expect(first).toHaveAttribute('data-fixture-card', 'retained'); await expect(first.getByRole('textbox', { name: 'Local card note' })).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally { finish(prepared); await demo.close(); }
});

test('automatic personal loading can be disabled without touching legacy trust/configuration', async ({ page }) => {
  let scans = 0;
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.autoLoad":false}', packages: {}, personal: async () => { scans++; return { entries: [], plugins: [], warnings: [] }; } }, { enforceCsp: true });
  try { await demo.turn(1); expect(scans).toBe(0); expect(demo.calls.some(call => call.command === 'load_personal_card_plugins')).toBe(false); expect(demo.errors).toEqual([]); }
  finally { await demo.close(); }
});
