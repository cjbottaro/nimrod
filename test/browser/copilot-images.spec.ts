import { expect, test, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

async function pasteImage(page: Page) {
  await page.locator(visible('prompt')).evaluate(prompt => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], 'Screenshot.png', { type: 'image/png' }));
    prompt.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
}

for (const caption of ['', 'Look at this screenshot']) test(`Copilot images use shared paste, optimistic adoption and follow (${caption || 'image only'})`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const pi = await page.locator('.session-view:not([hidden])').getAttribute('id');
    await page.locator(visible('prompt')).fill('Keep Pi draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session'); await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('model'))).toHaveText('small');
    const sdk = await page.locator('.session-view:not([hidden])').getAttribute('id');
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Create fixture history'); await prompt.press('Enter');
    await page.locator('#command-palette').getByRole('option', { name: 'Allow once', exact: true }).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline SDK response.');
    await expect(page.locator(visible('send'))).toHaveAttribute('aria-label', 'Send message');
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, -180);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    await page.evaluate(() => {
      const state = window as unknown as { __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }; __releaseCopilotImage: () => void };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const gate = new Promise<void>(resolve => { state.__releaseCopilotImage = resolve; });
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const message = args?.message as { method?: string; images?: unknown[] } | undefined;
        if (command === 'write_copilot' && message?.method === 'prompt' && message.images?.length) await gate;
        return invoke(command, args);
      };
    });
    await prompt.fill(caption); await prompt.focus(); await pasteImage(page);
    const tray = page.locator('.session-view:not([hidden]) .composer-attachments');
    await expect(tray.locator('img')).toHaveCount(1); await prompt.press('Enter');
    const image = page.locator(`${visible('messages')} .transcript-image img`);
    await expect(image).toHaveJSProperty('naturalWidth', 1);
    await expect(prompt).toHaveValue(''); await expect(tray).toBeHidden();
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await image.evaluate(node => { node.closest('article')!.dataset.fixtureIdentity = 'image-preview'; node.setAttribute('data-fixture-image', 'retained'); });
    await prompt.fill('Newer Copilot draft'); await pasteImage(page); await expect(tray.locator('img')).toHaveCount(1);
    await page.locator(`#open-sessions .session-row[aria-controls="${pi}"]`).click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Keep Pi draft');
    await page.evaluate(() => (window as unknown as { __releaseCopilotImage: () => void }).__releaseCopilotImage());
    await expect(page.locator(`#${sdk} [data-fixture-identity="image-preview"]`)).toHaveCount(1);
    await page.locator(`#open-sessions .session-row[aria-controls="${sdk}"]`).click();
    await expect(page.locator(visible('messages'))).toContainText('Offline SDK image response.');
    await expect(image).toHaveCount(1); await expect(image).toHaveAttribute('data-fixture-image', 'retained');
    await expect(image.locator('xpath=ancestor::article')).toHaveAttribute('data-fixture-identity', 'image-preview');
    await expect(page.locator(`${visible('messages')} .message.user`)).toHaveCount(2);
    await expect(prompt).toHaveValue('Newer Copilot draft'); await expect(tray.locator('img')).toHaveCount(1);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    const sends = demo.calls.filter(call => call.command === 'write_copilot' && (call.args.message as { method?: string; images?: unknown[] }).images?.length);
    expect(sends).toHaveLength(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
