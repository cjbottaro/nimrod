import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('Pixel options preserve live per-tile blur/fade through a partial close and clean up masks', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"pixel","appearance.modalAnimationDuration":1000}');
    const settings = await fixture.settingsWindow(); await settings.setViewportSize({ width: 1000, height: 900 });
    await settings.emulateMedia({ reducedMotion: 'no-preference' });
    const size = settings.locator('#modal-pixel-size'), blur = settings.locator('#modal-pixel-blur'), fade = settings.locator('#modal-pixel-fade');
    await expect(size).toHaveValue('48'); await expect(blur).toHaveValue('6'); await expect(fade).toBeChecked();
    await expect(size).toHaveCSS('--range-fill', '25%'); await expect(blur).toHaveCSS('--range-fill', '50%');
    await size.evaluate((input: HTMLInputElement) => { input.value = '96'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(settings.locator('#modal-pixel-size-value')).toHaveText('96 px target');
    await expect(settings.locator('html')).toHaveCSS('--modal-pixel-size', '96');
    await blur.evaluate((input: HTMLInputElement) => { input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(settings.locator('html')).toHaveCSS('--modal-pixel-blur', '4');
    const result = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!; dialog.style.height = '240px';
      document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const enter = document.querySelector<HTMLElement>('[data-modal-motion=enter]')!;
      const panel = dialog.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame))!;
      [panel, ...enter.getAnimations({ subtree: true })].forEach(animation => { animation.pause(); animation.currentTime = 500; });
      const alphas = [...enter.querySelectorAll('rect')].map(rect => getComputedStyle(rect).opacity);
      const filters = [...enter.querySelectorAll('[data-modal-pixel-blur-tile]')].map(tile => getComputedStyle(tile).getPropertyValue('backdrop-filter') || getComputedStyle(tile).getPropertyValue('-webkit-backdrop-filter'));
      dialog.querySelector('#modal-animation-preview-title')!.textContent = 'Still live while materializing';
      const copies = enter.querySelectorAll('form, input, textarea, dialog').length;
      dialog.querySelector<HTMLButtonElement>('button')!.click();
      if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
      const exit = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      exit.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 0; });
      const ghost = [...exit.children].find(node => node.shadowRoot)!;
      return { alphas, filters, copies, exitAlphas: [...exit.querySelectorAll('rect')].map(rect => getComputedStyle(rect).opacity),
        duration: ghost.getAnimations()[0].effect!.getTiming().duration,
        text: ghost.shadowRoot!.querySelector('[data-modal-snapshot-id="modal-animation-preview-title"]')!.textContent,
        open: dialog.open, focused: document.activeElement?.id };
    });
    expect(result.alphas.length).toBeGreaterThan(1); expect(result.alphas.some(alpha => Number(alpha) > 0 && Number(alpha) < 1)).toBe(true);
    expect(result.filters.some(filter => /^blur\((?:[1-3](?:\.\d+)?)px\)$/.test(filter))).toBe(true);
    expect(result.exitAlphas).toEqual(result.alphas); expect(result.copies).toBe(0); expect(result.duration).toBe(400);
    expect(result.text).toBe('Still live while materializing'); expect(result.open).toBe(false); expect(result.focused).toBe('modal-animation-preview');
    await settings.locator('#modal-animation-style').selectOption('none');
    await expect(settings.locator('[data-modal-pixel-mask], [data-modal-pixel-blur-tile]')).toHaveCount(0);
    await settings.locator('#modal-animation-style').selectOption('pixel');
    await blur.focus(); await blur.press('Home'); await expect(settings.locator('#modal-pixel-blur-value')).toHaveText('Off');
    await fade.uncheck(); await expect(settings.locator('html')).toHaveCSS('--modal-pixel-fade', 'false');
    await settings.locator('#modal-animation-preview').click();
    await expect(settings.locator('[data-modal-pixel-mask], [data-modal-pixel-blur-tile]')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
