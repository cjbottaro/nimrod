import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

async function mountAuxiliaryShells(page: Page) {
  // Project settings intentionally has no keybinding editor. Mount its actual
  // UI with fixture-only no-op storage rather than assuming global boot ran.
  for (const [entry, name, mount] of [
    ['src/pi/resume-modal.ts', 'TestResume', 'TestResume.createResumeModal(() => {}, () => {});'],
    ['src/keybinding-editor.ts', 'TestKeys', "TestKeys.installKeybindingEditor(window, document.querySelector('.settings-content'), { read: () => ({}), save: async () => {}, resetAll: async () => {} });"],
  ]) {
    const bundle = await build({ entryPoints: [entry], bundle: true, format: 'iife', globalName: name, write: false });
    await page.addScriptTag({ content: bundle.outputFiles![0].text + '\n' + mount });
  }
}

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

test('whole-window glass is shared by every modal and restores opaque fallbacks', async ({ page }) => {
  // Measure final surfaces, not a partially faded entrance frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Playwright cannot emulate this media feature; mock only its controller
  // signal, not OS settings. Real shell colours are still rendered by WebKit.
  await page.addInitScript(() => {
    const match = window.matchMedia.bind(window), lists: MediaQueryList[] = [];
    let reduced = false;
    window.matchMedia = query => {
      const result = match(query);
      if (query.includes('prefers-reduced-transparency')) {
        Object.defineProperty(result, 'matches', { get: () => reduced }); lists.push(result);
      }
      return result;
    };
    Object.assign(window, { __glassReduce(value: boolean) {
      reduced = value;
      for (const list of lists) list.dispatchEvent(new MediaQueryListEvent('change', { matches: value, media: list.media }));
    } });
  });
  const demo = await demoFixture(page);
  try {
    await mountAuxiliaryShells(page);
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my draft');
    for (const theme of ['nimrod', 'dracula', 'catalog-atom-one-light-vscode-atom-one-light']) {
      for (const [opacity, legacyArea] of [[65, undefined], [99, undefined], [100, undefined], [65, 'chrome']] as const) {
        await demo.editPreferences(JSON.stringify({ 'appearance.theme': theme, 'appearance.backgroundOpacity': opacity, 'appearance.translucencyArea': legacyArea }));
        const fills = await page.evaluate(() => {
          const pixel = (color: string) => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
          };
          const ids = ['command-palette', 'host-dialog', 'deletion-review', 'keybinding-recorder', 'resume-modal'];
          const result = ids.map(id => {
            const dialog = document.getElementById(id) as HTMLDialogElement;
            dialog.showModal(); const style = getComputedStyle(dialog);
            const field = dialog.querySelector('input, textarea, select');
            const body = id === 'deletion-review' ? dialog.querySelector('#deletion-tree') : field;
            const value = { surface: pixel(style.backgroundColor), opacity: style.opacity, inset: body ? pixel(getComputedStyle(body).backgroundColor) : undefined };
            dialog.close(); return value;
          });
          const overlay = document.querySelector('[data-pi-id="dialog"]')!; overlay.classList.add('open');
          const editor = getComputedStyle(overlay.querySelector('.nimrod-modal')!);
          result.push({ surface: pixel(editor.backgroundColor), opacity: editor.opacity, inset: undefined });
          overlay.classList.remove('open'); return result;
        });
        for (const fill of fills) {
          expect(fill.surface).toEqual(fills[0].surface); expect(fill.opacity).toBe('1');
          if (opacity < 100) {
            expect(fill.surface[3]).toBeLessThan(255); expect(fill.surface[3]).toBeGreaterThan(180);
            if (fill.inset) expect(fill.inset[3]).toBeLessThan(255);
          } else { expect(fill.surface[3]).toBe(255); }
        }
      }
    }
    await prompt.focus(); await expect(prompt).toHaveValue('Keep my draft'); await expect(prompt).toBeFocused();
    await demo.editPreferences(JSON.stringify({ 'appearance.backgroundOpacity': 65 }));
    await page.evaluate(() => (window as unknown as { __glassReduce(value: boolean): void }).__glassReduce(true));
    await expect(page.locator('html')).toHaveAttribute('data-translucency', 'off');
    await page.locator('#command-palette').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
    expect(await page.locator('#command-palette').evaluate(node => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!; context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    })).toBe(255);
    await page.keyboard.press('Escape'); expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('all ordinary shells share geometry and react to the same layout tokens', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await mountAuxiliaryShells(page);
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
