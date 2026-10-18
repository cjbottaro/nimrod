import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('CRT expands a theme-accent line vertically from the center in native and editor shells', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"crt","appearance.modalAnimationDuration":1000}');
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep my draft'); await prompt.focus();
    const samples = await page.evaluate(() => {
      document.documentElement.style.setProperty('--vscode-focusBorder', 'rgb(123, 45, 67)');
      const sample = (shell: HTMLElement) => {
        const animation = shell.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === 'modal-crt-enter')!;
        animation.pause(); animation.currentTime = 100;
        const style = getComputedStyle(shell);
        const line = new DOMMatrixReadOnly(style.transform);
        const glow = style.boxShadow;
        const origin = style.transformOrigin.split(' ').map(parseFloat);
        const center = { x: shell.offsetWidth / 2, y: shell.offsetHeight / 2 };
        animation.currentTime = 600;
        const expanding = new DOMMatrixReadOnly(getComputedStyle(shell).transform);
        animation.currentTime = 1000;
        const finished = getComputedStyle(shell).transform;
        return { lineX: line.a, lineY: line.d, expandingY: expanding.d, glow, origin, center, finished, duration: animation.effect!.getTiming().duration };
      };
      const dialog = document.querySelector<HTMLDialogElement>('#host-dialog')!;
      dialog.showModal();
      const native = sample(dialog);
      const field = dialog.querySelector('textarea')!; field.hidden = false; field.focus();
      const focused = document.activeElement === field;
      dialog.close();
      const restored = document.activeElement?.getAttribute('data-pi-id');
      const overlay = document.querySelector<HTMLElement>('[data-pi-id="dialog"]')!;
      overlay.classList.add('open');
      const editor = sample(overlay.querySelector<HTMLElement>('.nimrod-modal')!);
      overlay.classList.remove('open');
      return { native, editor, focused, restored };
    });
    for (const sample of [samples.native, samples.editor]) {
      expect(sample.duration).toBe(1000);
      expect(sample.lineX).toBeCloseTo(1);
      expect(sample.lineY).toBeCloseTo(.005, 3);
      expect(sample.expandingY).toBeGreaterThan(sample.lineY);
      expect(sample.expandingY).toBeLessThan(1);
      expect(sample.glow).toContain('rgb(123, 45, 67)');
      expect(sample.origin[0]).toBeCloseTo(sample.center.x, 0);
      expect(sample.origin[1]).toBeCloseTo(sample.center.y, 0);
      expect(sample.finished).toBe('none');
    }
    expect(samples.focused).toBe(true); expect(samples.restored).toBe('prompt');
    await expect(prompt).toHaveValue('Keep my draft');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.locator('#host-dialog').evaluate((dialog: HTMLDialogElement) => {
      dialog.showModal();
      const style = getComputedStyle(dialog);
      const result = { duration: style.animationDuration, transform: style.transform, shadow: style.boxShadow };
      dialog.close(); return result;
    });
    expect(reduced.duration).toBe('0s'); expect(reduced.transform).toBe('none');
    expect(reduced.shadow).not.toContain('rgb(123, 45, 67)');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
