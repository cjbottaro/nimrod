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
    await expect(page.locator('.session-view:not([hidden]) .image-recovery summary')).toHaveText('Image send recovery (1)');
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 1);
    expect((await fixture.metrics()).gap).toBeLessThanOrEqual(2);
    expect(fixture.calls.filter(call => call.command === 'plugin:clipboard-manager|read_image')).toHaveLength(0);
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
