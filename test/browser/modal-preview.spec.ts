import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const [style, dismissal] of [['subtle', 'button'], ['subtle', 'Escape'], ['hologram', 'button'], ['hologram', 'Escape'], ['pixel', 'button'], ['pixel', 'Escape']] as const) {
  test(`${style} preview native ${dismissal} dismissal shows an exit after trusted user input`, async ({ page }) => {
    const fixture = await demoFixture(page);
    try {
      await fixture.editPreferences(JSON.stringify({ 'appearance.modalAnimation': style, 'appearance.modalAnimationDuration': 1200, 'appearance.modalScanSpeed': 100 }));
      const settings = await fixture.settingsWindow();
      await settings.emulateMedia({ reducedMotion: 'no-preference' });
      const launch = settings.locator('#modal-animation-preview');
      const preview = settings.locator('#modal-animation-preview-dialog');
      await launch.click();
      if (style === 'pixel') await preview.evaluate(dialog => dialog.getAnimations().forEach(animation => animation.finish()));
      // Use trusted Playwright input, not element.click() inside page.evaluate:
      // native dispatch can checkpoint microtasks before the dialog default.
      if (dismissal === 'button') await preview.getByRole('button', { name: 'Close', exact: true }).click();
      else await settings.keyboard.press('Escape');
      await expect(preview).not.toHaveAttribute('open');
      await expect(launch).toBeFocused();
      await expect(settings.locator('#settings-page')).toHaveAttribute('open', '');
      const layer = settings.locator('[data-modal-motion=exit]');
      await expect(layer).toHaveCount(1);
      expect(await layer.evaluate(node => ({ inert: (node as HTMLElement).inert, hidden: node.getAttribute('aria-hidden'), pointer: getComputedStyle(node).pointerEvents })))
        .toEqual({ inert: true, hidden: 'true', pointer: 'none' });
      await launch.click();
      await expect(layer).toHaveCount(0);
      await expect(preview).toHaveAttribute('open', '');
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  });
}
