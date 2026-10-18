import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('global typography uses searchable font samples, synchronizes content only and resets without changing zoom', async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1);
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Preserve this draft');
    const originalInterface = await page.locator('#workspace-bar').evaluate(node => getComputedStyle(node).fontFamily);
    const settings = await fixture.settingsWindow();
    await settings.locator('#conversation-font').click();
    const picker = settings.locator('#font-picker');
    await expect(picker).toBeVisible();
    await settings.locator('#font-picker-search').fill('arial');
    await expect(picker.getByRole('option')).toHaveCount(1);
    await expect(picker.getByRole('option').locator('span')).toHaveCSS('font-family', /Arial/);
    await settings.locator('#font-picker-search').press('Enter');
    await expect(picker).toBeHidden();
    await expect(settings.locator('#settings-page')).toBeVisible();
    await expect(settings.locator('#conversation-font')).toBeFocused();
    await settings.locator('#conversation-font-size').fill('18');
    await settings.locator('#monospace-font').click();
    await expect(picker.getByRole('option').nth(1)).toContainText('Courier New');
    await settings.locator('#font-picker-search').fill('courier');
    await settings.locator('#font-picker-search').press('Enter');
    await settings.locator('#monospace-font-size').fill('16');
    await settings.locator('#typography-title').click();
    await expect(prompt).toHaveCSS('font-family', /Arial/);
    await expect(prompt).toHaveCSS('font-size', '18px');
    await expect(settings.locator('.typography-prose')).toHaveCSS('font-size', '18px');
    await expect(settings.locator('.typography-code code')).toHaveCSS('font-size', '16px');
    await expect(settings.locator('.typography-code code')).toHaveCSS('font-family', /Courier New/);
    await expect(prompt).toHaveValue('Preserve this draft');
    expect(await page.locator('#workspace-bar').evaluate(node => getComputedStyle(node).fontFamily)).toBe(originalInterface);
    await settings.locator('#typography-reset').click();
    await expect(prompt).toHaveCSS('font-size', '14px');
    await expect(settings.locator('#conversation-font')).toHaveText('System default ▾');
    expect(fixture.calls.filter(call => call.command === 'preferences_settings').some(call => String(call.args.text).includes('appearance.zoom'))).toBe(false);
    expect(fixture.calls.filter(call => call.command === 'installed_fonts')).toHaveLength(1);
    expect(fixture.calls.filter(call => call.command === 'start_pi')).toHaveLength(1);
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const follow of [false, true]) test(`typography reflow retains tool inspection, mounted cards and transcript intent (follow: ${follow})`, async ({ page }) => {
  const fixture = await demoFixture(page);
  try {
    await fixture.turn(1); await fixture.turn(2);
    const token = [...fixture.children.keys()][0];
    await page.evaluate(token => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      const emit = (value: object) => channels[token].onmessage({ kind: 'rpc', value });
      emit({ type: 'agent_start' });
      emit({ type: 'tool_execution_start', toolCallId: 'typography-output', toolName: 'bash', args: { command: 'fixture' } });
      emit({ type: 'tool_execution_update', toolCallId: 'typography-output', partialResult: { content: [{ type: 'text', text: Array.from({ length: 80 }, (_, i) => `Output line ${i}`).join('\n') }] } });
    }, token);
    const card = page.locator('details[data-detail-key="tool:typography-output"]');
    await expect(card).toBeVisible();
    await card.evaluate(node => { (node as HTMLDetailsElement).open = true; });
    await card.locator('.tool-output-streaming').evaluate(output => {
      output.scrollTop = 47;
      Object.assign(window, { typographyRetained: { card: output.closest('details'), output, top: output.scrollTop } });
    });
    await page.locator(visible('transcript-viewport')).hover();
    await page.mouse.wheel(0, follow ? 10000 : -10000);
    if (follow) await expect.poll(async () => (await fixture.metrics()).gap).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await fixture.metrics()).gap).toBeGreaterThan(100);
    const top = (await fixture.metrics()).top;
    await page.locator(visible('prompt')).fill('Retained draft');
    await fixture.editPreferences('{"appearance.conversationFontSize":22,"appearance.monospaceFontSize":18}');
    await expect(page.locator(visible('prompt'))).toHaveCSS('font-size', '22px');
    if (follow) await expect.poll(async () => (await fixture.metrics()).gap).toBeLessThanOrEqual(2);
    else await expect.poll(async () => Math.abs((await fixture.metrics()).top - top)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => {
      const state = (window as unknown as { typographyRetained: { card: HTMLDetailsElement; output: HTMLElement; top: number } }).typographyRetained;
      return { connected: state.card.isConnected && state.output.isConnected, open: state.card.open, top: state.output.scrollTop, previous: state.top };
    })).toEqual({ connected: true, open: true, top: 47, previous: 47 });
    await expect(page.locator(visible('prompt'))).toHaveValue('Retained draft');
    expect(fixture.errors).toEqual([]);
  } finally { await fixture.close(); }
});
