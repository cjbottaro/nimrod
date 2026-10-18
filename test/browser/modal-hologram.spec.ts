import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('Hologram preserves pixel position and velocity when a visible modal grows or shrinks', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"hologram","appearance.modalScanSpeed":1000}');
    const settings = await fixture.settingsWindow(); await settings.setViewportSize({ width: 1000, height: 900 }); await settings.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(settings.locator('#modal-animation-duration')).toHaveValue('1000');
    const result = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!; dialog.style.height = '300px';
      document.getElementById('modal-animation-preview')!.click(); await Promise.resolve();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const panelAnimation = () => dialog.getAnimations().find(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame))!;
      const beam = () => document.querySelector<HTMLElement>('[data-modal-motion=enter] [data-modal-hologram-line]')!;
      const pause = (time: number) => { [panelAnimation(), ...beam().getAnimations()].forEach(animation => { animation.pause(); animation.currentTime = time; }); };
      const y = () => { const rect = beam().getBoundingClientRect(); return rect.top + rect.height / 2; };
      const panel = panelAnimation(), line = beam().getAnimations()[0];
      const synchronized = panel.startTime === line.startTime;
      const duration = Number(panel.effect!.getTiming().duration);
      pause(75); const before = y();
      dialog.style.height = '400px';
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const newDuration = Number(panelAnimation().effect!.getTiming().duration);
      pause(0); const after = y(); pause(50); const moved = y();
      const root = document.documentElement, zoom = root.getBoundingClientRect().width / root.offsetWidth;
      dialog.style.height = '100px'; // Current edge has passed the new bottom.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return { duration, newDuration, before, after, delta: (moved - after) / zoom, synchronized, open: dialog.open,
        clip: getComputedStyle(dialog).clipPath, layers: document.querySelectorAll('[data-modal-motion=enter]').length, focused: dialog.contains(document.activeElement) };
    });
    expect(result.duration).toBeCloseTo(300, 1); expect(result.newDuration).toBeCloseTo(325, 1);
    expect(result.before).toBeCloseTo(result.after, 0); expect(result.delta).toBeCloseTo(50, 1);
    expect(result.synchronized).toBe(true); expect(result.open).toBe(true); expect(result.focused).toBe(true);
    expect(result.layers).toBe(0); expect(result.clip).toBe('none');
    // Closing uses the frozen 100px copy: 100 / (1000 * 1.25) seconds.
    const exit = await settings.evaluate(async () => {
      const dialog = document.querySelector<HTMLDialogElement>('#modal-animation-preview-dialog')!;
      dialog.querySelector<HTMLButtonElement>('button')!.click();
      if (!document.querySelector('[data-modal-motion=exit]')) await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
      const layer = document.querySelector<HTMLElement>('[data-modal-motion=exit]')!;
      const panel = [...layer.children].find(node => node.shadowRoot)!;
      const duration = Number(panel.getAnimations()[0].effect!.getTiming().duration);
      return { duration, open: dialog.open, focused: document.activeElement?.id, opacity: getComputedStyle(panel).opacity };
    });
    expect(exit.duration).toBeCloseTo(80, 1); expect(exit.open).toBe(false); expect(exit.focused).toBe('modal-animation-preview'); expect(exit.opacity).toBe('1');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('typing can filter a picker during a slow scan without waiting or changing its draft', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.editPreferences('{"appearance.modalAnimation":"hologram","appearance.modalScanSpeed":100}');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep my unsent draft');
    const primary = await page.evaluate(() => /Mac|iPhone|iPad/i.test(navigator.platform)) ? 'Meta' : 'Control';
    await page.keyboard.press(primary + '+Shift+P');
    await expect(page.locator('#palette-input')).toBeFocused();
    await page.keyboard.type('runtime');
    await expect(page.locator('#palette-input')).toHaveValue('runtime');
    await expect(page.locator('#command-palette')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(prompt).toHaveValue('Keep my unsent draft'); await expect(prompt).toBeFocused();
    expect(fixture.calls.some(call => (call.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
