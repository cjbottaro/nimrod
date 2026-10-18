import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('Hologram preview scans down with the reveal and reverses upward on dismissal', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"hologram"}');
    const settings = await fixture.settingsWindow();
    await settings.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(settings.locator('#modal-animation-style')).toHaveValue('hologram');
    await expect(settings.locator('#modal-animation-duration')).toHaveValue('300');
    const opening = await settings.evaluate(async () => {
      document.documentElement.style.setProperty('--vscode-focusBorder', 'rgb(123, 45, 67)');
      document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      const panel = dialog.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === 'modal-hologram-enter')!;
      const beam = document.querySelector<HTMLElement>('[data-modal-motion=enter] [data-modal-hologram-line]')!;
      const scan = beam.getAnimations()[0], synchronized = panel.startTime === scan.startTime;
      panel.pause(); scan.pause();
      const sample = (fraction: number) => {
        panel.currentTime = scan.currentTime = 300 * fraction;
        const rect = dialog.getBoundingClientRect(), edge = beam.getBoundingClientRect(), style = getComputedStyle(dialog);
        return { progress: (edge.top + edge.height / 2 - rect.top) / rect.height, clip: style.clipPath, opacity: style.opacity, transform: style.transform, background: style.backgroundColor };
      };
      const start = sample(0), early = sample(.25), late = sample(.75), end = sample(.999);
      dialog.style.height = '300px';
      panel.currentTime = scan.currentTime = 150;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const resized = sample(.5);
      panel.currentTime = scan.currentTime = 300;
      return { start, early, late, end, resized, synchronized, color: getComputedStyle(beam).backgroundColor, height: getComputedStyle(beam).height, trail: !!beam.querySelector('[data-modal-hologram-trail]'), iterations: scan.effect!.getTiming().iterations, focused: dialog.contains(document.activeElement) };
    });
    expect(opening.synchronized).toBe(true);
    expect(opening.start.progress).toBeCloseTo(0, 2); expect(opening.end.progress).toBeCloseTo(.999, 2);
    expect(opening.early.progress).toBeCloseTo(.25, 2); expect(opening.late.progress).toBeCloseTo(.75, 2);
    expect(opening.resized.progress).toBeCloseTo(.5, 2);
    expect(opening.early.clip).toContain('75%'); expect(opening.late.clip).toContain('25%');
    expect(opening.early.opacity).toBe('1'); expect(opening.late.opacity).toBe('1');
    expect(opening.early.transform).toBe('none'); expect(opening.early.background).not.toBe(opening.color);
    expect(opening.color).toBe('rgb(123, 45, 67)'); expect(opening.height).toBe('2px');
    expect(opening.trail).toBe(true); expect(opening.iterations).toBe(1); expect(opening.focused).toBe(true);
    const closing = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      dialog.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve();
      // Native close events are queued; this listener is registered before
      // this task returns, and runs after the document motion capture handler.
      if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const panel = [...layer.children].find(node => node.shadowRoot)!;
      const beam = layer.querySelector<HTMLElement>('[data-modal-hologram-line]')!;
      const animations = layer.getAnimations({ subtree: true });
      const synchronized = animations.every(animation => animation.startTime === animations[0].startTime);
      const rect = panel.getBoundingClientRect();
      const sample = (fraction: number) => {
        animations.forEach(animation => { animation.pause(); animation.currentTime = 240 * fraction; });
        const edge = beam.getBoundingClientRect();
        return { progress: (edge.top + edge.height / 2 - rect.top) / rect.height, opacity: getComputedStyle(panel).opacity };
      };
      return { start: sample(0), early: sample(.25), late: sample(.75), end: sample(.999), synchronized, reverse: animations.every(animation => animation.effect!.getTiming().direction === 'reverse'), durations: animations.map(animation => animation.effect!.getTiming().duration), layerOpacity: getComputedStyle(layer).opacity, open: dialog.open, focused: document.activeElement?.id };
    });
    expect(closing.open).toBe(false); expect(closing.focused).toBe('modal-animation-preview');
    expect(closing.synchronized).toBe(true);
    expect(closing.start.progress).toBeCloseTo(1, 2); expect(closing.end.progress).toBeCloseTo(.001, 2);
    expect(closing.early.progress).toBeCloseTo(.75, 2); expect(closing.late.progress).toBeCloseTo(.25, 2);
    expect(closing.reverse).toBe(true); expect(closing.durations.every(duration => duration === 240)).toBe(true);
    expect(closing.early.opacity).toBe('1'); expect(closing.late.opacity).toBe('1'); expect(closing.layerOpacity).toBe('1');
    await settings.emulateMedia({ reducedMotion: 'reduce' });
    await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
    await settings.locator('#modal-animation-preview').click();
    await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
    await settings.keyboard.press('Escape');
    await expect(settings.locator('#modal-animation-preview-dialog')).not.toHaveAttribute('open');
    await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
