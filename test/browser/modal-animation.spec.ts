import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('modal style options, duration retention, preview and cross-window synchronization', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-modal-animation')).toBeHidden();
    const settings = await fixture.settingsWindow();
    const style = settings.locator('#modal-animation-style');
    const duration = settings.locator('#modal-animation-duration');
    await expect(style).toHaveValue('subtle');
    await expect(duration).toHaveValue('160');
    await duration.fill('1200'); await duration.press('Tab');
    await expect(page.locator('html')).toHaveCSS('--modal-enter-duration', '1200ms');
    await expect(page.locator('html')).toHaveCSS('--modal-exit-duration', '900ms');
    await style.selectOption('none');
    await expect(settings.locator('#modal-animation-options')).toBeHidden();
    await expect(page.locator('html')).toHaveCSS('--modal-enter-duration', '0ms');
    await style.selectOption('crt');
    await expect(duration).toHaveValue('1200');
    await expect(settings.locator('#modal-animation-hint')).toContainText('CRT powering on');
    await expect(page.locator('html')).toHaveAttribute('data-modal-animation', 'crt');
    await expect(page.locator('html')).toHaveCSS('--modal-exit-duration', '960ms');
    await expect(settings.locator('#modal-animation-hint')).toContainText('takes 20% less time');
    await style.selectOption('subtle');
    await expect(duration).toHaveValue('1200');
    await settings.locator('#modal-animation-preview').click();
    const preview = settings.locator('#modal-animation-preview-dialog');
    await expect(preview).toHaveAttribute('open', '');
    await expect(preview.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await settings.keyboard.press('Escape');
    await expect(preview).not.toHaveAttribute('open');
    await expect(settings.locator('#modal-animation-preview')).toBeFocused();
    await expect(settings.locator('#settings-page')).toHaveAttribute('open', '');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('entrance accepts input immediately, dismissal restores focus, and reduced motion wins', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimationDuration":1200}');
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Keep my draft');
    await prompt.focus();
    // Use an otherwise idle shared shell, without issuing a harness request.
    const enter = await page.locator('#host-dialog').evaluate((dialog: HTMLDialogElement) => {
      dialog.showModal();
      const animation = dialog.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === 'modal-subtle-enter')!;
      animation.pause(); animation.currentTime = 600;
      const field = dialog.querySelector('textarea')!;
      field.hidden = false; field.focus(); field.value = 'Typing during entrance';
      return { duration: animation.effect!.getTiming().duration, transform: getComputedStyle(dialog).transform, focused: document.activeElement === field };
    });
    expect(enter.duration).toBe(1200); expect(enter.transform).not.toBe('none'); expect(enter.focused).toBe(true);
    const closed = await page.locator('#host-dialog').evaluate((dialog: HTMLDialogElement) => {
      dialog.close();
      return { open: dialog.open, focused: document.activeElement?.getAttribute('data-pi-id') };
    });
    expect(closed.open).toBe(false); expect(closed.focused).toBe('prompt');
    await expect(prompt).toHaveValue('Keep my draft');
    for (const mode of ['none', 'reduced'] as const) {
      if (mode === 'none') await fixture.editPreferences('{"appearance.modalAnimation":"none"}');
      else {
        await fixture.editPreferences('{"appearance.modalAnimationDuration":1200}');
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      const result = await page.locator('#host-dialog').evaluate((dialog: HTMLDialogElement) => {
        dialog.showModal();
        const result = { duration: getComputedStyle(dialog).animationDuration, transform: getComputedStyle(dialog).transform };
        dialog.close(); return result;
      });
      expect(result).toEqual({ duration: '0s', transform: 'none' });
    }
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
