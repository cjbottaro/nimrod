import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { build } from 'esbuild';

test('command rows have a secondary description and right-aligned title-line shortcut', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my draft');
    await page.keyboard.press(primary + '+Shift+P');
    const rows = page.locator('#palette-list [role=option]');
    const layout = await rows.evaluateAll(nodes => nodes.map(node => {
      const heading = node.querySelector('.palette-item-heading')!;
      const description = node.querySelector('.palette-item-description')!;
      const shortcut = heading.querySelector('kbd');
      const rect = heading.getBoundingClientRect(), desc = description.getBoundingClientRect();
      const key = shortcut?.getBoundingClientRect();
      return {
        description: description.textContent?.trim(),
        below: desc.top >= rect.bottom,
        aligned: !key || Math.abs(key.right - rect.right) < 1 && Math.abs(key.top - rect.top) < 4,
        muted: getComputedStyle(description).color !== getComputedStyle(heading).color,
        children: node.children.length,
      };
    }));
    expect(layout.length).toBeGreaterThan(5);
    for (const row of layout) {
      expect(row.description).toBeTruthy(); expect(row.below).toBe(true);
      expect(row.aligned).toBe(true); expect(row.muted).toBe(true); expect(row.children).toBe(2);
    }
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveValue('Keep my draft'); await expect(prompt).toBeFocused();
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('all ordinary shells share geometry and react to the same layout tokens', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const resume = await build({ entryPoints: ['src/pi/resume-modal.ts'], bundle: true, format: 'iife', globalName: 'TestResume', write: false });
    await page.addScriptTag({ content: resume.outputFiles![0].text + '\nTestResume.createResumeModal(() => {}, () => {});' });
    // Show shells directly: exercise CSS without executing any command or Pi request.
    for (const viewport of [{ width: 800, height: 520 }, { width: 420, height: 700 }]) {
      await page.setViewportSize(viewport);
      const styles = await page.evaluate(() => {
        const ids = ['command-palette', 'host-dialog', 'deletion-review', 'keybinding-recorder', 'resume-modal'];
        const read = (node: Element) => {
          const style = getComputedStyle(node);
          return Object.fromEntries(['width', 'top', 'maxHeight', 'padding', 'border', 'borderRadius', 'backgroundColor', 'color', 'boxShadow'].map(key => [key, style[key as keyof CSSStyleDeclaration]]));
        };
        const before = ids.map(id => {
          const node = document.getElementById(id) as HTMLDialogElement;
          node.showModal(); const style = read(node); node.close(); return style;
        });
        const editor = document.querySelector('[data-pi-id="dialog"]')!;
        editor.classList.add('open');
        before.push(read(editor.querySelector('.nimrod-modal')!)); editor.classList.remove('open');
        document.documentElement.style.setProperty('--modal-width', '260px');
        document.documentElement.style.setProperty('--modal-padding', '18px');
        const after = ids.map(id => {
          const node = document.getElementById(id) as HTMLDialogElement;
          node.showModal(); const style = read(node); node.close(); return style;
        });
        editor.classList.add('open');
        after.push(read(editor.querySelector('.nimrod-modal')!)); editor.classList.remove('open');
        document.documentElement.style.removeProperty('--modal-width');
        document.documentElement.style.removeProperty('--modal-padding');
        return { before, after };
      });
      for (const style of styles.before) expect(style).toEqual(styles.before[0]);
      for (const style of styles.after) expect(style).toEqual(styles.after[0]);
      expect(styles.after[0].padding).toBe('18px');
      expect(styles.after[0].width).not.toBe(styles.before[0].width);
    }
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
