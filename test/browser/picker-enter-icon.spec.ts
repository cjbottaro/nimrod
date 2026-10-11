import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('session pickers share the theme picker Enter icon and title-line alignment', async ({ page }) => {
  const catalog = ['First', 'Second'].map((name, index) => ({
    path: `/fixture/${index}.jsonl`, sessionId: String(index), name: name + ' conversation '.repeat(30),
    preview: '', modified: 100, lastUserMessageAt: 100,
  }));
  const demo = await demoFixture(page, {}, catalog);
  try {
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const open = async (command: string) => {
      await page.keyboard.press(primary + '+Shift+P');
      await page.locator('#palette-input').fill(command);
      await page.locator('#palette-input').press('Enter');
      await expect(page.locator('#palette-list .picker-enter-hint').first()).toBeAttached();
    };
    const geometry = () => page.locator('#palette-list [aria-selected=true]').evaluate(row => {
      const icon = row.querySelector('.picker-enter-hint')!, label = row.querySelector('.palette-item-label')!;
      const bounds = icon.getBoundingClientRect(), title = label.getBoundingClientRect();
      return {
        width: bounds.width, height: bounds.height, path: icon.querySelector('path')!.getAttribute('d'),
        stroke: icon.getAttribute('stroke-width'), centerOffset: bounds.top + bounds.height / 2 - title.top - title.height / 2,
        gap: bounds.left - title.right, visibility: getComputedStyle(icon).visibility,
      };
    });
    await open('Select theme');
    const theme = await geometry();
    await page.keyboard.press('Escape');
    for (const width of [1100, 500]) {
      await page.setViewportSize({ width, height: 700 });
      for (const command of ['Resume session', 'Switch session', 'Delete sessions']) {
        await open(command);
        const session = await geometry();
        expect(session.width).toBe(theme.width); expect(session.height).toBe(theme.height);
        expect(session.path).toBe(theme.path); expect(session.stroke).toBe(theme.stroke);
        expect(Math.abs(session.centerOffset)).toBeLessThan(1);
        expect(session.gap).toBeGreaterThanOrEqual(7); expect(session.visibility).toBe('visible');
        if (command !== 'Switch session') {
          const labels = page.locator('#palette-list .palette-item-label');
          const before = await labels.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
          await expect(page.locator('#palette-list [aria-selected=false] .picker-enter-hint')).toHaveCSS('visibility', 'hidden');
          await page.locator('#palette-input').press('ArrowDown');
          expect(await labels.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))).toEqual(before);
        }
        await page.keyboard.press('Escape');
      }
    }
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
