import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('requested edit plugin copies through the host without sending a prompt, changing draft, disclosure or focus', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], undefined, undefined, { tool: 'edit' });
  try {
    await demo.turn(1);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'edit' }) }).first();
    await card.locator('summary').first().click();
    const copy = card.getByRole('button', { name: 'Copy requested diff' });
    await expect(copy).toBeEnabled();
    const prompt = page.locator(visible('prompt')); await prompt.fill('unchanged draft');
    const count = demo.calls.filter(call => call.command === 'write_pi' && (call.args.message as { type?: string })?.type === 'prompt').length;
    // WebKit pointer clicks need not focus buttons. Exercise keyboard intent explicitly.
    await copy.focus(); await copy.press('Enter');
    await expect(card.locator('.card-plugin-copy-status')).toHaveText('Copied');
    await expect(copy).toBeFocused(); await expect(card).toHaveAttribute('open', ''); await expect(prompt).toHaveValue('unchanged draft');
    const writes = demo.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text');
    expect(writes.at(-1)?.args.text).toBe('-const count = 1;\n+const count = 2;');
    expect(demo.calls.filter(call => call.command === 'write_pi' && (call.args.message as { type?: string })?.type === 'prompt')).toHaveLength(count);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
