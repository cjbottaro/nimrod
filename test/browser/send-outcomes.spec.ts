import { test, expect, type Page } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import type { JsonRecord } from '../../src/pi/types';
import type { Packet } from '../../src/pi/transport';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
type HeldWindow = Window & {
  __fixtureHost(command: string, args: JsonRecord): Promise<unknown>;
  __fixtureChannels: Record<string, { onmessage(packet: Packet): void }>;
  __heldPrompt?: { token: string; message: JsonRecord };
  __promptAttempts: number;
};
async function holdPrompt(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as HeldWindow;
    const original = state.__fixtureHost;
    state.__promptAttempts = 0;
    state.__fixtureHost = async (command, args) => {
      if (command === 'write_pi' && (args.message as JsonRecord)?.type === 'prompt') {
        state.__promptAttempts++; state.__heldPrompt = { token: String(args.token), message: args.message as JsonRecord }; return;
      }
      return original(command, args);
    };
  });
}
async function rejectPrompt(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as HeldWindow, held = state.__heldPrompt!;
    state.__fixtureChannels[held.token].onmessage({ kind: 'rpc', value: { type: 'response', command: 'prompt', id: held.message.id, success: false, error: 'Offline fixture rejected this message.' } });
  });
}
async function paste(page: Page) {
  await page.locator(visible('prompt')).evaluate((prompt, base64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'Photo.png', { type: 'image/png' }));
    prompt.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
}
const attempts = (page: Page) => page.evaluate(() => (window as unknown as HeldWindow).__promptAttempts);

test('definitive rejection marks the retained transcript turn without composer recovery controls', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await holdPrompt(page); await page.locator(visible('prompt')).fill('Failed caption'); await paste(page);
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments img')).toHaveCount(1);
    await page.locator(visible('prompt')).press('Enter'); await expect.poll(() => attempts(page)).toBe(1);
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments')).toBeHidden();
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Failed caption' });
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.steering-status')).toHaveCount(0);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'failed-turn'; });
    await rejectPrompt(page);
    await expect(page.locator(visible('session-notices'))).toContainText('Offline fixture rejected');
    await expect(turn.locator('.steering-status')).toHaveText('Not sent');
    await expect(turn).toHaveAttribute('data-test-identity', 'failed-turn');
    await expect(turn.locator('.transcript-image img')).toHaveCount(1);
    await expect(page.locator(visible('prompt'))).toHaveValue('');
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments')).toBeHidden();
    await expect(page.locator('.image-recovery, [data-recovery-id]')).toHaveCount(0);
    await page.locator(visible('prompt')).press('Enter'); expect(await attempts(page)).toBe(1);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('sending another message does not wait for the first acknowledgement; failure never edits the next draft', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await holdPrompt(page);
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('First message'); await prompt.press('Enter');
    await expect.poll(() => attempts(page)).toBe(1);
    await expect(prompt).toHaveValue('');
    await expect(page.locator(visible('send'))).toBeEnabled();
    await prompt.fill('Second message'); await prompt.press('Enter');
    await expect.poll(() => attempts(page)).toBe(2);
    await prompt.fill('Second message');
    await rejectPrompt(page);
    await expect(page.locator(visible('session-notices'))).toContainText('Offline fixture rejected');
    await expect(prompt).toHaveValue('Second message');
    await expect(page.locator(visible('send'))).toBeEnabled();
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('rejection preserves newer text and images while marking the failed transcript turn', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await holdPrompt(page); await page.locator(visible('prompt')).fill('Old caption'); await paste(page);
    const tray = page.locator('.session-view:not([hidden]) .composer-attachments');
    await expect(tray.locator('img')).toHaveCount(1); await page.locator(visible('prompt')).press('Enter');
    await expect.poll(() => attempts(page)).toBe(1);
    await page.locator(visible('prompt')).fill('New caption'); await paste(page); await expect(tray.locator('img')).toHaveCount(1);
    await rejectPrompt(page);
    await expect(page.locator(visible('prompt'))).toHaveValue('New caption'); await expect(tray.locator('img')).toHaveCount(1);
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Old caption' });
    await expect(turn).toHaveCount(1); await expect(turn.locator('.steering-status')).toHaveText('Not sent');
    await expect(page.locator('.image-recovery, [data-recovery-id]')).toHaveCount(0);
    expect(await attempts(page)).toBe(1); expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

test('unknown delivery reports an error without composer recovery or replay', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await holdPrompt(page); await page.locator(visible('prompt')).fill('Maybe received'); await paste(page);
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments img')).toHaveCount(1);
    await page.locator(visible('prompt')).press('Enter'); await expect.poll(() => attempts(page)).toBe(1);
    await page.evaluate(() => {
      const state = window as unknown as HeldWindow;
      state.__fixtureChannels[state.__heldPrompt!.token].onmessage({ kind: 'disconnected', message: 'Offline fixture connection lost before acknowledgement' });
    });
    await expect(page.locator(visible('session-notices'))).toContainText('did not confirm');
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Maybe received' });
    await expect(turn).toHaveCount(1); await expect(turn.locator('.steering-status')).toHaveText('Acceptance unknown');
    await page.locator(visible('prompt')).press('Enter'); expect(await attempts(page)).toBe(1);
    await expect(page.getByRole('button', { name: 'Write a new message', exact: true })).toHaveCount(0);
    await expect(page.locator(visible('prompt'))).toHaveValue(''); await expect(page.locator(visible('prompt'))).toBeFocused();
    await expect(page.locator('.session-view:not([hidden]) .composer-attachments')).toBeHidden();
    await page.locator(visible('prompt')).press('Enter'); expect(await attempts(page)).toBe(1);
    await expect(page.locator('.image-recovery, [data-recovery-id]')).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
