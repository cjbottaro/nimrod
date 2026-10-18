import { expect, test, type Page } from '@playwright/test';
import { demoFixture } from './demo-fixture';

async function samples(page: Page, png: Buffer) {
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return [[.37, .33], [.9, .33], [.37, .85], [.9, .85]].map(([x, y]) =>
      [...context.getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1).data]);
  }, png.toString('base64'));
}

for (const zoom of [1, 1.25, 1.5]) {
  test(`Pixel alpha mask covers the unchanged modal at ${zoom * 100}% CSS zoom`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await fixture.editPreferences('{"appearance.modalAnimation":"pixel","appearance.modalAnimationDuration":1000,"appearance.modalPixelBlur":0,"appearance.modalPixelFade":true}');
      const settings = await fixture.settingsWindow(); await settings.setViewportSize({ width: 1000, height: 900 });
      await settings.emulateMedia({ reducedMotion: 'no-preference' });
      await settings.evaluate(zoom => {
        document.documentElement.style.zoom = String(zoom);
        document.body.style.height = `calc(100dvh / ${zoom})`;
      }, zoom);
      const geometry = await settings.evaluate(async () => {
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
        const color = document.createElement('div'); color.setAttribute('aria-hidden', 'true');
        color.style.cssText = 'position:absolute;inset:16px;background:rgb(17,153,85);z-index:1;pointer-events:none;';
        dialog.append(color); // Test-only paint target, deliberately out of layout.
        document.getElementById('modal-animation-preview')!.click();
        const rect = () => { const box = dialog.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
        const before = rect();
        await Promise.resolve(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const layer = document.querySelector<HTMLElement>('[data-modal-motion=enter]')!;
        const panel = dialog.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame))!;
        [panel, ...layer.getAnimations({ subtree: true })].forEach(animation => { animation.pause(); animation.currentTime = 999.9; });
        return { before, masked: rect(), units: layer.querySelector('mask')!.getAttribute('maskUnits') };
      });
      const dialog = settings.locator('#modal-animation-preview-dialog');
      const masked = await samples(settings, await dialog.screenshot({ scale: 'css' }));
      const settled = await settings.evaluate(async () => {
        const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
        const layer = document.querySelector<HTMLElement>('[data-modal-motion=enter]')!;
        [...dialog.getAnimations(), ...layer.getAnimations({ subtree: true })].forEach(animation => animation.finish());
        await Promise.resolve(); await Promise.resolve();
        const box = dialog.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
      await expect(settings.locator('[data-modal-motion=enter]')).toHaveCount(0);
      const complete = await samples(settings, await dialog.screenshot({ scale: 'css' }));
      expect(geometry.units).toBe('objectBoundingBox');
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(geometry.masked[key]).toBeCloseTo(geometry.before[key], 1);
        expect(settled[key]).toBeCloseTo(geometry.before[key], 1);
      }
      for (const pixels of [masked, complete]) for (const pixel of pixels) {
        expect(Math.abs(pixel[0] - 17)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[1] - 153)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[2] - 85)).toBeLessThanOrEqual(1);
      }
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}
