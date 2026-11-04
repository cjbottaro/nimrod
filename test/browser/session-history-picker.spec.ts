import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// Isolated shared-picker fixture: no application, harness process or user history.
for (const outcome of ['cancel', 'delete'] as const) test(`incremental history keeps a screen anchor and buffers updates during ${outcome}`, async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const css = ['src/theme.css', 'src/workspace.css', 'src/modal.css'].map(path => readFileSync(path, 'utf8')).join('\n');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '');
  await page.setContent(html.replace('</head>', `<style>${css}</style></head>`));
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { installCommandPalette } from './src/command-palette';
    const dialog = document.querySelector('#command-palette');
    const review = document.querySelector('#deletion-review');
    const deleted = new Set();
    let publish, finish;
    const load = (signal, update) => { publish = update; return new Promise(() => {}); };
    const palette = installCommandPalette(window, dialog, {
      commands: () => [], canOpen: () => true, sessions: load, deleteSessions: load,
      openSessions: () => ({items: []}), sessionDeleted: id => deleted.has(id),
    });
    const items = Array.from({length: 40}, (_, index) => makeItem('saved-' + index));
    function makeItem(id) {
      return { id, label: id, sessionRow: { key: id, title: id, harnessLabel: 'Pi', status: 'closed', open: false, timestamp: 100 },
        async run() { review.showModal(); document.querySelector('#deletion-confirm').focus();
          await new Promise(resolve => { finish = ids => { ids.forEach(id => deleted.add(id)); review.close(); resolve(); }; });
        } };
    }
    window.pickerFixture = {
      insert(id) { items.unshift(makeItem(id)); publish({items: [...items]}); },
      finish(ids) { finish(ids); },
      selected() { return dialog.querySelector('[aria-selected="true"]').dataset.key; },
    };
    void palette.deleteSessions(); publish({items: [...items]});
  ` }, bundle: true, format: 'iife', platform: 'browser', write: false });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const input = page.locator('#palette-input');
  await input.focus();
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowDown');
  const selected = page.locator('#palette-list [data-key="saved-12"]');
  const before = (await selected.boundingBox())!;
  await page.evaluate(() => {
    const state = window as unknown as { pickerFixture: { insert(id: string): void }; retainedRow: Element | null };
    state.retainedRow = document.querySelector('#palette-list [aria-selected="true"]');
    state.pickerFixture.insert('newest');
  });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  expect(Math.abs((await selected.boundingBox())!.y - before.y)).toBeLessThan(1);
  expect(await page.evaluate(() => (window as unknown as { retainedRow: Element }).retainedRow === document.querySelector('#palette-list [aria-selected="true"]'))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#deletion-review')).toBeVisible();
  await expect(page.locator('#deletion-confirm')).toBeFocused();
  await page.evaluate(() => (window as unknown as { pickerFixture: { insert(id: string): void } }).pickerFixture.insert('during-review'));
  await expect(page.locator('#palette-list [data-key="during-review"]')).toHaveCount(0);
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(outcome => (window as unknown as { pickerFixture: { finish(ids: string[]): void } }).pickerFixture.finish(outcome === 'delete' ? ['saved-12'] : []), outcome);
  await expect(page.locator('#deletion-review')).not.toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.locator('#palette-list [data-key="during-review"]')).toHaveCount(1);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toHaveAttribute('data-key', outcome === 'delete' ? 'saved-13' : 'saved-12');
  if (outcome === 'cancel') expect(Math.abs((await selected.boundingBox())!.y - before.y)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#command-palette')).not.toBeVisible();
});
