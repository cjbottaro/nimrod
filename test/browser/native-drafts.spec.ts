import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('persistent sends clear native drafts without persisting a submission or recovery copy', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], { persistent: true, drafts: {} });
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Native saved draft');
    await expect.poll(() => [...demo.nativeDrafts.values()].some(record => (record.value as { draft?: string }).draft === 'Native saved draft')).toBe(true);
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    const promptCall = demo.calls.findIndex(call => call.command === 'write_pi' && (call.args.message as { type: string }).type === 'prompt');
    expect(promptCall).toBeGreaterThanOrEqual(0);
    await expect.poll(() => [...demo.nativeDrafts.values()].some(record => (record.value as { draft?: string }).draft === '')).toBe(true);
    const staged = demo.calls.filter(call => call.command === 'drafts_stage').map(call => (call.args.record as { value: Record<string, unknown> }).value);
    expect(staged.some(value => Object.hasOwn(value, 'submission'))).toBe(false);
    expect([...demo.nativeDrafts.values()].some(record => (record.value as { draft?: string }).draft === 'Native saved draft')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
