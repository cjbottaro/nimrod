import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { demoFixture, visible } from './demo-fixture';

for (const fallback of [false, true]) {
  test(`host answers grow from one line and submit with Enter (${fallback ? 'fallback' : 'native'} sizing)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const demo = await demoFixture(page);
    try {
      const prompt = page.locator(visible('prompt'));
      await prompt.fill('Keep my draft');
      if (fallback) {
        await page.addStyleTag({ content: '#host-dialog-input { field-sizing:fixed; }' });
        await page.evaluate(() => {
          const supports = CSS.supports.bind(CSS);
          CSS.supports = (property: string, value?: string) => property === 'field-sizing' ? false
            : value === undefined ? supports(property) : supports(property, value);
        });
      }
      const bundle = await build({ entryPoints: ['src/dialogs.ts'], bundle: true, format: 'iife', globalName: 'TestDialogs', write: false });
      await page.addScriptTag({ content: bundle.outputFiles![0].text + `
        window.modalInputs = new TestDialogs.Dialogs();
        window.openAnswer = (prefill = '') => {
          window.answerResult = null;
          window.modalInputs.input('Answer question', prefill, 'fixture', 'Submit answer').then(value => window.answerResult = { value });
        };
      ` });
      await page.evaluate('window.openAnswer()');
      const field = page.locator('#host-dialog-input');
      await expect(field).toBeFocused();
      const height = (await field.boundingBox())!.height;
      expect(height).toBeLessThanOrEqual(44);
      await field.fill('First line');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('Second line');
      await expect(field).toHaveValue('First line\nSecond line');
      await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(height);
      await field.fill(Array.from({ length: 30 }, () => 'Long answer').join('\n'));
      await expect.poll(async () => (await field.boundingBox())!.height).toBeLessThanOrEqual(160);
      await expect.poll(() => field.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await field.fill('Short answer');
      await expect.poll(async () => (await field.boundingBox())!.height).toBe(height);
      const borders = await page.locator('#host-dialog .modal-actions, #deletion-review .modal-actions').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopWidth));
      expect(borders).toEqual(['0px', '0px']);
      await page.keyboard.press('Enter');
      await expect(page.locator('#host-dialog')).not.toBeVisible();
      await expect.poll(() => page.evaluate('window.answerResult')).toEqual({ value: 'Short answer' });
      await expect(prompt).toHaveValue('Keep my draft');
      await expect(prompt).toBeFocused();
      await page.evaluate("window.openAnswer('Prefilled\\nmultiline\\nanswer')");
      await expect(field).toBeFocused();
      expect((await field.boundingBox())!.height).toBeGreaterThan(height);
      await page.keyboard.press('Escape');
      await expect(page.locator('#host-dialog')).not.toBeVisible();
      await expect.poll(() => page.evaluate('window.answerResult')).toEqual({ value: undefined });
      await expect(prompt).toHaveValue('Keep my draft');
      expect(demo.errors).toEqual([]);
    } finally { await demo.close(); }
  });
}
