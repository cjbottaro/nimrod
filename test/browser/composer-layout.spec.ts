import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

for (const width of [1100, 600]) {
  test(`prompt hides horizontal overflow when empty, typed and cleared (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const demo = await demoFixture(page);
    try {
      const prompt = page.locator(visible('prompt'));
      await expect(prompt).toBeVisible();
      await expect(prompt).toHaveValue('');
      await expect(prompt).toHaveAttribute('placeholder', /\S/);
      await expect(prompt).toHaveCSS('overflow-x', 'hidden');

      await prompt.fill('Hello');
      await expect(prompt).toHaveCSS('overflow-x', 'hidden');
      await prompt.fill('');
      await expect(prompt).toHaveCSS('overflow-x', 'hidden');

      // Long unbroken text must still wrap, and the height cap must retain
      // vertical scrolling rather than clipping the editable draft.
      await prompt.fill('x'.repeat(8000));
      await expect.poll(() => prompt.evaluate(field => {
        const input = field as HTMLTextAreaElement;
        return input.scrollHeight > input.clientHeight
          && input.scrollWidth <= input.clientWidth + 1
          && getComputedStyle(input).overflowY === 'auto';
      })).toBe(true);
      await expect(prompt).toHaveCSS('overflow-x', 'hidden');

      await prompt.fill('');
      await expect.poll(() => prompt.evaluate(field => field.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
      await expect(prompt).toHaveCSS('overflow-x', 'hidden');
      expect(demo.errors).toEqual([]);
    } finally { await demo.close(); }
  });
}
