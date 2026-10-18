import { expect, test, type Page } from '@playwright/test';
import { demoFixture } from './demo-fixture';

const ids = ['background-opacity', 'background-blur', 'modal-animation-duration'];
async function trackPixels(page: Page) {
  const pngs: string[] = [];
  for (const id of ids) pngs.push((await page.locator('#' + id).screenshot({ scale: 'css' })).toString('base64'));
  return page.evaluate(async pngs => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--vscode-focusBorder');
    context.fillRect(0, 0, 1, 1);
    const accent = [...context.getImageData(0, 0, 1, 1).data];
    const tracks = await Promise.all(pngs.map(async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const pixel = (fraction: number) => [...context.getImageData(Math.floor(image.width * fraction), Math.floor(image.height / 2), 1, 1).data];
      return { filled: pixel(.1), empty: pixel(.9) };
    }));
    return { accent, tracks };
  }, pngs);
}

test('all Settings sliders paint their accent fill on first display and external reload without input', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.backgroundOpacity":65,"appearance.backgroundBlur":20,"appearance.modalAnimationDuration":500}');
    const settings = await fixture.settingsWindow();
    for (const id of ids) await expect(settings.locator('#' + id)).toBeEnabled();
    for (const [id, fill] of [['background-opacity', '65%'], ['background-blur', '50%'], ['modal-animation-duration', '28.5714%']]) {
      await expect(settings.locator('#' + id)).toHaveCSS('--range-fill', fill);
    }
    const initial = await trackPixels(settings);
    for (const track of initial.tracks) {
      expect(track.filled).toEqual(initial.accent);
      expect(track.empty).not.toEqual(initial.accent);
    }
    expect(fixture.calls.filter(call => call.command === 'preferences_settings')).toHaveLength(0);
    expect(fixture.calls.filter(call => call.command === 'preview_window_appearance')).toHaveLength(0);
    // A palette/value broadcast must repaint without manufacturing a drag.
    await fixture.editPreferences('{"appearance.theme":"tokyo-night","appearance.backgroundOpacity":70,"appearance.backgroundBlur":30,"appearance.modalAnimationDuration":1200}');
    await expect(settings.locator('#background-opacity')).toHaveCSS('--range-fill', '70%');
    await expect(settings.locator('#background-blur')).toHaveCSS('--range-fill', '75%');
    await expect(settings.locator('#modal-animation-duration')).toHaveCSS('--range-fill', '78.5714%');
    const reloaded = await trackPixels(settings);
    for (const track of reloaded.tracks) {
      expect(track.filled).toEqual(reloaded.accent);
      expect(track.empty).not.toEqual(reloaded.accent);
    }
    await settings.locator('#modal-animation-duration').focus();
    await settings.keyboard.press('ArrowRight');
    await expect(settings.locator('#modal-animation-duration')).toHaveValue('1210');
    await expect(settings.locator('#modal-animation-duration')).toBeFocused();
    await expect(settings.locator('#modal-animation-duration')).toHaveCSS('--range-fill', '79.2857%');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
