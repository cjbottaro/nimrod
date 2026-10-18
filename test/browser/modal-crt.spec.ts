import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const duration of [160, 500]) {
  test(`CRT uses a separate two-pixel beam without tinting the panel at ${duration} ms`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await fixture.editPreferences(JSON.stringify({ 'appearance.modalAnimation': 'crt', 'appearance.modalAnimationDuration': duration }));
      const settings = await fixture.settingsWindow();
      await settings.emulateMedia({ reducedMotion: 'no-preference' });
      const sample = await settings.evaluate(async duration => {
        document.documentElement.style.setProperty('--vscode-focusBorder', 'rgb(123, 45, 67)');
        document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
        const animation = dialog.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === 'modal-crt-enter')!;
        animation.pause(); animation.currentTime = duration * .1;
        const beam = document.querySelector<HTMLElement>('[data-modal-motion=enter] [data-modal-crt-line]')!;
        beam.getAnimations().forEach(item => { item.pause(); item.currentTime = duration * .1; });
        const style = getComputedStyle(dialog), line = getComputedStyle(beam);
        const start = { clip: style.clipPath, shadow: style.boxShadow, background: style.backgroundColor, transform: style.transform };
        animation.currentTime = duration * .6;
        const middle = getComputedStyle(dialog).clipPath;
        animation.currentTime = duration;
        return { start, middle, final: getComputedStyle(dialog).clipPath, lineHeight: line.height, lineColor: line.backgroundColor, lineGlow: line.boxShadow, focused: dialog.contains(document.activeElement), duration: animation.effect!.getTiming().duration };
      }, duration);
      expect(sample.duration).toBe(duration);
      expect(sample.start.clip).toContain('50%'); expect(sample.start.transform).toBe('none');
      expect(sample.middle).not.toBe(sample.start.clip); expect(sample.final).toBe('none');
      expect(sample.lineHeight).toBe('2px'); expect(sample.lineColor).toBe('rgb(123, 45, 67)');
      expect(sample.lineGlow).toContain('rgb(123, 45, 67)');
      expect(sample.start.background).not.toBe(sample.lineColor);
      expect(sample.start.shadow).not.toContain('inset'); expect(sample.focused).toBe(true);
      // Native method=dialog closure is immediate; only an inert visual copy remains.
      const exit = await settings.evaluate(async () => {
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
        dialog.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve();
        const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
        const animations = layer.getAnimations({ subtree: true });
        animations.forEach(animation => { animation.pause(); animation.currentTime = 0; });
        return { open: dialog.open, focused: document.activeElement?.id, inert: layer.inert, pointerEvents: getComputedStyle(layer).pointerEvents, durations: animations.map(animation => animation.effect!.getTiming().duration), duplicateIds: document.querySelectorAll('#modal-animation-preview-dialog').length };
      });
      expect(exit.open).toBe(false); expect(exit.focused).toBe('modal-animation-preview');
      expect(exit.inert).toBe(true); expect(exit.pointerEvents).toBe('none');
      expect(exit.durations.length).toBeGreaterThanOrEqual(2);
      expect(exit.durations.every(value => value === Math.round(duration * .75))).toBe(true);
      expect(exit.duplicateIds).toBe(1);
      // A new interaction retires the old exit; it never waits for animation completion.
      await settings.locator('#modal-animation-preview').click();
      await expect(settings.locator('[data-modal-motion=exit]')).toHaveCount(0);
      await expect(settings.locator('#modal-animation-preview-dialog')).toHaveAttribute('open', '');
      await settings.emulateMedia({ reducedMotion: 'reduce' });
      await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
      await settings.keyboard.press('Escape');
      await expect(settings.locator('#modal-animation-preview-dialog')).not.toHaveAttribute('open');
      await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('visual exit still works without popovers or CSS overlay retention, above its parent Settings dialog', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"subtle","appearance.modalAnimationDuration":500}');
    const settings = await fixture.settingsWindow();
    await settings.emulateMedia({ reducedMotion: 'no-preference' });
    await settings.evaluate(() => Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: undefined }));
    await settings.locator('#modal-animation-preview').click();
    const result = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      dialog.getAnimations().forEach(animation => animation.finish());
      dialog.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve();
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      layer.getAnimations({ subtree: true }).forEach(animation => animation.pause());
      return { open: dialog.open, parent: layer.parentElement?.id, focused: document.activeElement?.id, parentOpen: document.querySelector<HTMLDialogElement>('#settings-page')!.open };
    });
    expect(result).toEqual({ open: false, parent: 'settings-page', focused: 'modal-animation-preview', parentOpen: true });
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
