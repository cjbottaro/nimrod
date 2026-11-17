import { expect, test, type Locator, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const sweetDracula = 'catalog-ovsx-proxzima-sweetdracula-626c68bb-theme-sweetdracula-color-theme-json-e4b58042';

async function highlightPixels(page: Page, target: Locator) {
  const screenshot = await target.screenshot({ path: test.info().outputPath(`selection-${test.info().attachments.length}.png`), scale: 'css', caret: 'hide' });
  await test.info().attach('selection-paint', { body: screenshot, contentType: 'image/png' });
  const png = screenshot.toString('base64');
  const fill = await target.evaluate(node => getComputedStyle(node, '::selection').backgroundColor);
  return page.evaluate(async ({ png, fill }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill; context.fillRect(0, 0, 1, 1);
    const expected = [...context.getImageData(0, 0, 1, 1).data];
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let matching = 0;
    const histogram = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (expected.every((channel, index) => Math.abs(channel - pixels[i + index]) <= 1)) matching++;
      const color = [...pixels.slice(i, i + 3)].join(','); histogram.set(color, (histogram.get(color) ?? 0) + 1);
    }
    return { fill, matching, dominant: [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 5) };
  }, { png, fill });
}

for (const scheme of ['dark', 'light'] as const) for (const [theme, label] of [['nimrod', 'Nimrod'], [sweetDracula, 'Sweet Dracula']]) test(`${scheme}/${label}: selected composer and transcript text really paints a highlight`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: scheme });
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1);
    await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': 100 }));
    const prompt = page.locator(visible('prompt'));
    const prose = page.locator(visible('messages') + ' .message:not(.user) .markdown p:visible').first();
    await expect(prose).toBeVisible();
    await prompt.fill('Highlight this selected composer text.');
    for (const opacity of [100, 65, 0]) {
      await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity }));
      await prompt.focus();
      await prompt.evaluate(node => (node as HTMLTextAreaElement).setSelectionRange(0, 0));
      const inputBefore = await highlightPixels(page, prompt);
      await prompt.evaluate(node => { const field = node as HTMLTextAreaElement; field.setSelectionRange(0, field.value.length); });
      const inputSelected = await highlightPixels(page, prompt);
      expect.soft(inputSelected.matching - inputBefore.matching, JSON.stringify({ surface: 'input', opacity, inputBefore, inputSelected })).toBeGreaterThan(100);
      await prompt.evaluate(node => (node as HTMLTextAreaElement).setSelectionRange(0, 0));
      await prose.scrollIntoViewIfNeeded();
      await prose.click();
      await page.evaluate(() => getSelection()?.removeAllRanges());
      const proseBefore = await highlightPixels(page, prose);
      await prose.evaluate(node => getSelection()?.selectAllChildren(node));
      const proseSelected = await highlightPixels(page, prose);
      expect.soft(proseSelected.matching - proseBefore.matching, JSON.stringify({ surface: 'content', opacity, proseBefore, proseSelected })).toBeGreaterThan(100);
      await page.evaluate(() => getSelection()?.removeAllRanges());
    }
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
