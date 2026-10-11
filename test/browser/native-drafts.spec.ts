import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('persistent prompts stage and flush recovery before offline Pi submission; legacy drafts stay ignored', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], { persistent: true, drafts: {} });
  try {
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Native saved draft');
    await expect.poll(() => [...demo.nativeDrafts.values()].some(record => (record.value as { draft?: string }).draft === 'Native saved draft')).toBe(true);
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    const promptCall = demo.calls.findIndex(call => call.command === 'write_pi' && (call.args.message as { type: string }).type === 'prompt');
    const submissionStage = demo.calls.findIndex(call => call.command === 'drafts_stage' && !!((call.args.record as { value: { submission?: unknown } }).value.submission));
    expect(submissionStage).toBeGreaterThanOrEqual(0);
    expect(demo.calls.slice(submissionStage, promptCall).some(call => call.command === 'drafts_flush')).toBe(true);
    expect(promptCall).toBeGreaterThan(submissionStage);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
