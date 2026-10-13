import { build } from 'esbuild';
import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
async function paste(page: import('@playwright/test').Page, text = '') {
  await page.locator(visible('prompt')).evaluate((prompt, { data, text }) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'Screenshot.png', { type: 'image/png' }));
    if (text) transfer.setData('text/plain', text);
    prompt.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { data: PNG, text });
}

test('paste previews, removes and sends image-only turns', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await page.locator(visible('prompt')).focus();
    await paste(page);
    const tray = page.locator('.session-view:not([hidden]) .composer-attachments');
    await expect(tray.locator('img')).toHaveCount(1);
    await expect(tray.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await tray.locator('button').click();
    await expect(tray).toBeHidden();
    await paste(page);
    await expect(tray.locator('img')).toHaveCount(1);
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('.session-view:not([hidden]) .message.user .transcript-image img')).toHaveCount(1);
    await expect(tray).toBeHidden();
    await expect(page.locator('.session-view:not([hidden]) .image-recovery')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore images', exact: true })).toHaveCount(0);
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 1);
    expect((await fixture.metrics()).gap).toBeLessThanOrEqual(2);
    expect(fixture.calls.filter(call => call.command === 'plugin:clipboard-manager|read_image')).toHaveLength(0);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const readingHistory of [false, true]) test(`idle image Send adopts Pi-normalized content once and follows from ${readingHistory ? 'history reading' : 'bottom follow'}`, async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1); await fixture.turn(2);
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await fixture.metrics()).gap).toBeGreaterThan(100);
    }
    // Simulate Pi's preflight normalization in the offline transport fixture,
    // not by matching captions or launching a real harness/model.
    await page.evaluate(() => {
      const state = window as unknown as {
        __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
        __releaseNormalizedImage?: () => void;
      };
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const gate = new Promise<void>(resolve => { state.__releaseNormalizedImage = resolve; });
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const request = args?.message as { type?: string; message?: string; images?: { type: string; mimeType: string; data: string }[] };
        if (command === 'write_pi' && request.type === 'prompt' && request.images?.length) {
          await gate;
          const image = new Image(); image.src = `data:${request.images[0].mimeType};base64,${request.images[0].data}`;
          await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d')!.drawImage(image, 0, 0);
          const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          return invoke(command, { ...args, message: { ...request, message: `${request.message}\n\nPi fixture normalized the attachment.`, images: [{ type: 'image', mimeType: 'image/jpeg', data }] } });
        }
        return invoke(command, args);
      };
    });
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Look at this'); await prompt.focus(); await paste(page); await prompt.press('Enter');
    const messages = page.locator(visible('messages'));
    const turn = messages.locator('.message.user').filter({ hasText: 'Look at this' });
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'image-preview'; });
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await expect(messages.locator('.queued-turns .message')).toHaveCount(0);
    const original = await turn.locator('img').getAttribute('src');
    await prompt.fill('Newer draft');
    await page.evaluate(() => (window as unknown as { __releaseNormalizedImage: () => void }).__releaseNormalizedImage());
    await expect(turn).toContainText('Pi fixture normalized the attachment.');
    await expect(turn).toHaveCount(1);
    await expect(turn).toHaveAttribute('data-test-identity', 'image-preview');
    await expect(turn.locator('img')).toHaveJSProperty('naturalWidth', 1);
    expect(await turn.locator('img').getAttribute('src')).not.toBe(original);
    await expect(messages.locator('.transcript-image img')).toHaveCount(1);
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    await expect(messages.locator('.message.user')).toHaveCount(3);
    await expect(messages.locator('.transcript-image img')).toHaveCount(1);
    await expect(messages.locator('.queued-turns .message')).toHaveCount(0);
    await expect(prompt).toHaveValue('Newer draft'); await expect(prompt).toBeFocused();
    await expect.poll(async () => (await fixture.metrics()).gap).toBeLessThanOrEqual(2);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('an explicitly queued image unpins once, without duplicating the image during later output', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Start offline work'); await prompt.press('Enter');
    await expect(page.locator(visible('keyboard-hint'))).toContainText('Enter to steer');
    await prompt.fill('Queued image'); await paste(page); await prompt.press('Alt+Enter');
    const messages = page.locator(visible('messages'));
    const turn = messages.locator('.message.user').filter({ hasText: 'Queued image' });
    await expect(messages.locator('.queued-turns .transcript-image img')).toHaveCount(1);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'queued-image-preview'; });
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 1);
    await expect(turn).toHaveCount(1);
    await expect(turn).toHaveAttribute('data-test-identity', 'queued-image-preview');
    await expect(turn).not.toHaveClass(/sticky-turn/);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await expect(messages.locator('.transcript-image img')).toHaveCount(1);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('mixed text/image paste preserves selection and session-local attachments', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('before after'); await prompt.focus();
    await prompt.evaluate(node => (node as HTMLTextAreaElement).setSelectionRange(7, 12));
    await paste(page, 'caption');
    await expect(prompt).toHaveValue('before caption');
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments img')).toHaveCount(1);
    await page.keyboard.press('Meta+Shift+N');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments')).toBeHidden();
    await page.locator('#open-sessions .session-row').last().click();
    await expect(page.locator(visible('prompt'))).toHaveValue('before caption');
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments img')).toHaveCount(1);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});


test('persistent image store survives reopening and keeps Blob bytes outside draft metadata', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    const bundle = await build({ entryPoints: ['src/attachment-store.ts'], bundle: true, format: 'iife', globalName: 'ImageStore', write: false, platform: 'browser' });
    await page.addScriptTag({ content: bundle.outputFiles![0].text });
    const result = await page.evaluate(async data => {
      const Store = (window as unknown as { ImageStore: { AttachmentStore: new () => { put(blob: Blob, name: string): Promise<{ id: string }>; get(image: unknown): Promise<Blob> } } }).ImageStore.AttachmentStore;
      const store = new Store();
      const blob = new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: 'image/png' });
      const image = await store.put(blob, 'Persistent screenshot');
      localStorage.setItem('nimrod.sessions.v1:/image-fixture', JSON.stringify({ drafts: { 'file:/fixture': { attachments: [image] } } }));
      const restored = new Store();
      const loaded = await restored.get(image);
      let missing = false;
      try { await restored.get({ ...image, id: 'missing' }); } catch { missing = true; }
      return { size: loaded.size, type: loaded.type, original: blob.size, metadata: localStorage.getItem('nimrod.sessions.v1:/image-fixture'), missing };
    }, PNG);
    expect(result.size).toBe(result.original);
    expect(result.type).toBe('image/png');
    expect(result.metadata).not.toContain(PNG);
    expect(result.missing).toBe(true);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
