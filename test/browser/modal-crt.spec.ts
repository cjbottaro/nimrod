import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const height of [150, 300]) {
  test(`CRT edges move at the configured pixel speed in a ${height}px modal`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await fixture.editPreferences('{"appearance.modalAnimation":"crt","appearance.modalScanSpeed":500}');
      const settings = await fixture.settingsWindow(); await settings.setViewportSize({ width: 1000, height: 900 }); await settings.emulateMedia({ reducedMotion: 'no-preference' });
      const enter = await settings.evaluate(async height => {
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!; dialog.style.height = height + 'px';
        document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const panel = dialog.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame))!;
        const beams = [...document.querySelectorAll<HTMLElement>('[data-modal-motion=enter] [data-modal-crt-line]')];
        const animations = [panel, ...beams.flatMap(beam => beam.getAnimations())];
        const synchronized = animations.every(animation => animation.startTime === panel.startTime);
        const duration = Number(panel.effect!.getTiming().duration);
        animations.forEach(animation => { animation.pause(); animation.currentTime = duration * .25; });
        const rect = dialog.getBoundingClientRect();
        const edges = beams.map(beam => { const edge = beam.getBoundingClientRect(); return (edge.top + edge.height / 2 - rect.top) / rect.height; });
        animations.forEach(animation => { animation.currentTime = duration; });
        return { duration, edges, synchronized, focused: dialog.contains(document.activeElement), opacity: getComputedStyle(dialog).opacity };
      }, height);
      expect(enter.duration).toBeCloseTo(height, 1); expect(enter.edges[0]).toBeCloseTo(.375, 2); expect(enter.edges[1]).toBeCloseTo(.625, 2);
      expect(enter.synchronized).toBe(true); expect(enter.focused).toBe(true); expect(enter.opacity).toBe('1');
      const exit = await settings.evaluate(async () => {
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
        dialog.querySelector<HTMLButtonElement>('button')!.click(); await Promise.resolve();
        if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
        const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const panel = [...layer.children].find(node => node.shadowRoot)!;
        const animation = panel.getAnimations()[0], duration = Number(animation.effect!.getTiming().duration);
        layer.getAnimations({ subtree: true }).forEach(item => { item.pause(); item.currentTime = duration / 2; });
        const rect = panel.getBoundingClientRect();
        const edges = [...layer.querySelectorAll('[data-modal-crt-line]')].map(beam => { const edge = beam.getBoundingClientRect(); return (edge.top + edge.height / 2 - rect.top) / rect.height; });
        return { duration, edges, open: dialog.open, focused: document.activeElement?.id, opacity: getComputedStyle(panel).opacity, inert: layer.inert };
      });
      expect(exit.duration).toBeCloseTo(height * .8, 1); expect(exit.edges[0]).toBeCloseTo(.25, 2); expect(exit.edges[1]).toBeCloseTo(.75, 2);
      expect(exit.open).toBe(false); expect(exit.focused).toBe('modal-animation-preview'); expect(exit.opacity).toBe('1'); expect(exit.inert).toBe(true);
      await settings.locator('#modal-animation-preview').click(); await expect(settings.locator('[data-modal-motion=exit]')).toHaveCount(0);
      await settings.emulateMedia({ reducedMotion: 'reduce' }); await expect(settings.locator('[data-modal-motion]')).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('visual exit works without popovers above its remaining parent Settings dialog', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"subtle","appearance.modalAnimationDuration":500}');
    const settings = await fixture.settingsWindow(); await settings.emulateMedia({ reducedMotion: 'no-preference' });
    await settings.evaluate(() => Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: undefined }));
    await settings.locator('#modal-animation-preview').click();
    const result = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      dialog.getAnimations().forEach(animation => animation.finish()); dialog.querySelector<HTMLButtonElement>('button')!.click();
      if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      layer.getAnimations({ subtree: true }).forEach(animation => animation.pause());
      return { open: dialog.open, parent: layer.parentElement?.id, focused: document.activeElement?.id };
    });
    expect(result).toEqual({ open: false, parent: 'settings-page', focused: 'modal-animation-preview' }); expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
