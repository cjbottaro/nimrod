import { expect, test } from '@playwright/test';
import { buttonContrast } from '../../src/button-surfaces';
import { demoFixture, visible } from './demo-fixture';

// Offline computed-style coverage, not native selection-paint acceptance.
test('text highlights use opaque contrast-protected roles across themes, surfaces and opacity', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep this selected draft');
    await prompt.evaluate(node => { (node as HTMLTextAreaElement).setSelectionRange(5, 9); });
    await page.evaluate(() => {
      const sample = document.createElement('div'); sample.id = 'selection-fixture';
      sample.innerHTML = '<pre><code>Selected code</code></pre><div class="nimrod-modal">Selected modal text</div>';
      document.body.append(sample);
    });
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const theme of ['nimrod', 'tokyo-night', 'dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
        for (const opacity of [0, 65, 100]) {
          await fixture.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity }));
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          for (const [selector, role, backing] of [
            [visible('prompt'), 'input', 'input-background'],
            [visible('messages'), 'content', 'editor-background'],
            ['#selection-fixture code', 'code', 'textCodeBlock-background'],
            ['#selection-fixture .nimrod-modal', 'widget', 'editorWidget-background'],
          ]) {
            const colors = await page.locator(selector).evaluate((node, { role, backing }) => {
              const selected = getComputedStyle(node, '::selection');
              const root = getComputedStyle(document.documentElement);
              const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
              const context = canvas.getContext('2d')!;
              const rgba = (color: string) => {
                context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
                const bytes = [...context.getImageData(0, 0, 1, 1).data];
                return { hex: '#' + bytes.slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join(''), alpha: bytes[3] };
              };
              return {
                fill: rgba(selected.backgroundColor), text: rgba(selected.color),
                expected: rgba(root.getPropertyValue(`--nimrod-${role}-text-selection-background`)),
                backing: rgba(root.getPropertyValue('--vscode-' + backing)),
              };
            }, { role, backing });
            expect(colors.fill).toEqual(colors.expected);
            expect(colors.fill.alpha).toBe(255); expect(colors.text.alpha).toBe(255);
            expect(buttonContrast(colors.text.hex, colors.fill.hex, 1)).toBeGreaterThanOrEqual(4.5);
            expect(buttonContrast(colors.fill.hex, colors.backing.hex, 1)).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
    await expect(prompt).toHaveValue('Keep this selected draft');
    expect(await prompt.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([5, 9]);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
