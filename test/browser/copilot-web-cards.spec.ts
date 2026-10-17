import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { copilotToolResult } from '../../src/copilot/tool-result';
import { capturedWebExample } from '../copilot-web-fixtures';

test('offline Copilot web cards render cited answers, partial fetches and URL permissions without navigation', async ({ page }) => {
  const state = { [`nimrod.tabs.v1:${process.cwd()}`]: { tabs: [{ kind: 'copilot-sdk', sessionId: 'fixture-sdk', name: 'Copilot web' }] } };
  const demo = await demoFixture(page, state);
  try {
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Copilot web' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    const connection = demo.calls.find(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'connect')!;
    const token = connection.args.token as string;
    const packets = (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value });
    }, { token, values });
    const update = (updates: { type: string; data: object }[]) => packets(updates.map(event => ({ kind: 'event', event: { id: crypto.randomUUID(), ...event } })));
    const searchExample = capturedWebExample('search-scoped'), fetchExample = capturedWebExample('fetch-partial');
    const failedExample = capturedWebExample('fetch-permission-error');
    await update([searchExample.start, searchExample.complete, fetchExample.start, fetchExample.complete, failedExample.start, failedExample.complete]);
    const search = page.locator('details[data-detail-key="tool:search-scoped"]');
    const fetch = page.locator('details[data-detail-key="tool:fetch-partial"]');
    await expect(search.locator('.tool-card-title')).toHaveText('Web search');
    await expect(search.locator('.tool-card-preview')).toHaveText(String(searchExample.start.data.arguments.query));
    await expect(fetch.locator('.tool-card-preview')).toHaveText('docs.github.com/en/copilot/concepts/agents/about-copilot-cli');
    for (const card of [search, fetch]) await card.locator(':scope > summary').click();
    await expect(search.locator('[data-output-kind="web-sources"] li')).toHaveCount(3);
    await expect(search.locator('[data-output-kind="web-sources"] li').first()).toContainText('docs.github.com');
    await expect(search.locator('.card-plugin-body [data-output-kind="result"]')).not.toContainText('†source');
    await expect(fetch.locator('[data-output-kind="fetch-partial"]')).toContainText('start_index of 10000');
    await expect(fetch.locator('[data-output-kind="fetch-redirect"] a')).toHaveAttribute('href', 'https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-cli');
    await expect(fetch.locator('.card-plugin-body script, .card-plugin-body img')).toHaveCount(0);
    const location = page.url();
    await search.locator('.card-plugin-body [data-output-kind="result"]').getByRole('link', { name: '[1]', exact: true }).first().click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_card_link').length).toBe(1);
    expect(demo.calls.find(call => call.command === 'open_card_link')!.args.href).toBe('https://docs.github.com/copilot/concepts/agents/copilot-cli/autopilot');
    await fetch.locator('.card-plugin-body [data-output-kind="result"]').getByRole('link', { name: 'Installing GitHub Copilot CLI', exact: true }).click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_card_link').length).toBe(2);
    expect(demo.calls.filter(call => call.command === 'open_card_link')[1].args.href).toBe('https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli');
    expect(page.url()).toBe(location);
    await search.locator(':scope > .tool-raw-output > summary').click();
    expect(await search.locator(':scope > .tool-raw-output pre').textContent()).toBe(copilotToolResult(searchExample.complete.data.result!));
    await expect(page.locator('details[data-detail-key="tool:fetch-permission-error"] .tool-card-failed')).toHaveCount(1);
    await page.locator(visible('prompt')).fill('url permission fixture');
    await page.locator(visible('prompt')).press('Enter');
    const permission = page.locator('.acp-permission').filter({ hasText: 'https://example.test/permission' });
    await expect(permission).toBeVisible();
    await expect(permission.locator('.acp-permission-summary')).toHaveText('Fetch · example.test/permission');
    await expect(permission.locator('.acp-permission-raw')).not.toHaveAttribute('open', '');
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision')).toBe(false);
    await permission.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(() => demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision')).toBe(true);
    const reply = demo.calls.find(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'decision')!.args.message as { value: unknown };
    expect(reply.value).toEqual({ kind: 'reject' });
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
