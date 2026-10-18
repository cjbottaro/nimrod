import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('Pixel dissolve previews a bounded mosaic and reverses a partial opening without a full-panel flash', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"pixel","appearance.modalAnimationDuration":500}');
    const settings = await fixture.settingsWindow(); await settings.setViewportSize({ width: 1000, height: 900 });
    await settings.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(settings.locator('#modal-animation-style')).toHaveValue('pixel');
    await expect(settings.locator('#modal-animation-value-label')).toHaveText('Duration (milliseconds)');
    const opening = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!; dialog.style.height = '240px';
      document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=enter]')!;
      const animation = dialog.getAnimations().find(item => (item.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame))!;
      const effects = [animation, ...layer.getAnimations({ subtree: true })];
      effects.forEach(effect => { effect.pause(); effect.currentTime = 0; }); const start = getComputedStyle(dialog).clipPath;
      effects.forEach(effect => { effect.currentTime = 250; }); const middle = getComputedStyle(dialog).clipPath;
      return { start, middle, tiles: Number(layer.dataset.modalPixelTiles), copies: layer.querySelectorAll('form, input, textarea, dialog').length,
        frames: (animation.effect as KeyframeEffect).getKeyframes().length, duration: animation.effect!.getTiming().duration,
        opacity: getComputedStyle(dialog).opacity, focused: dialog.contains(document.activeElement) };
    });
    expect(opening.start).toContain('path('); expect(opening.middle).toContain('path('); expect(opening.start).not.toBe(opening.middle);
    expect(opening.tiles).toBeGreaterThan(1); expect(opening.tiles).toBeLessThanOrEqual(96); expect(opening.copies).toBe(0);
    expect(opening.frames).toBe(13); expect(opening.duration).toBe(500); expect(opening.opacity).toBe('1'); expect(opening.focused).toBe(true);
    const closing = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      const captured = getComputedStyle(dialog).clipPath;
      dialog.querySelector<HTMLButtonElement>('button')!.click();
      if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const panel = [...layer.children].find(node => node.shadowRoot)!;
      const animation = panel.getAnimations()[0]; animation.pause(); animation.currentTime = 0;
      return { captured, initial: getComputedStyle(panel).clipPath, duration: animation.effect!.getTiming().duration,
        direction: animation.effect!.getTiming().direction, opacity: getComputedStyle(panel).opacity, layerOpacity: getComputedStyle(layer).opacity,
        open: dialog.open, focused: document.activeElement?.id, inert: layer.inert };
    });
    expect(closing.initial).toBe(closing.captured); expect(closing.duration).toBe(200); expect(closing.direction).toBe('reverse');
    expect(closing.opacity).toBe('1'); expect(closing.layerOpacity).toBe('1'); expect(closing.open).toBe(false);
    expect(closing.focused).toBe('modal-animation-preview'); expect(closing.inert).toBe(true);
    await settings.locator('#modal-animation-preview').click();
    await expect(settings.locator('[data-modal-motion=exit]')).toHaveCount(0);
    await settings.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      document.getElementById('modal-animation-preview-dialog')!.style.height = '300px';
    });
    await expect(settings.locator('[data-modal-motion=enter]')).toHaveCount(0);
    await expect(settings.locator('#modal-animation-preview-dialog')).toHaveAttribute('open', '');
    await settings.emulateMedia({ reducedMotion: 'reduce' }); await settings.keyboard.press('Escape');
    await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
