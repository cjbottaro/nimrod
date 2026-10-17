import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('offline legacy Copilot web cards render cited answers, partial fetches and URL permissions without navigation', async ({ page }) => {
  const state = { [`nimrod.tabs.v1:${process.cwd()}`]: { tabs: [{ kind: 'acp', profile: 'copilot', sessionId: 'fixture-acp', name: 'Legacy Copilot web' }] } };
  const demo = await demoFixture(page, state, [], undefined, undefined, { acpAgentName: 'Copilot' });
  try {
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Legacy Copilot web' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    const connection = demo.calls.find(call => call.command === 'write_acp' && (call.args.message as { method?: string }).method === 'session/load')!;
    const token = connection.args.token as string;
    const packets = (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value: { jsonrpc: '2.0', ...value } });
    }, { token, values });
    const update = (updates: object[]) => packets(updates.map(update => ({ method: 'session/update', params: { sessionId: 'fixture-acp', update } })));
    const marker = '\u30101:1\u2020source\u3011';
    const answer = `## Answer\n\n**Useful information** ${marker}`;
    const structuredContent = { type: 'output_text', text: { value: answer, annotations: [{ start_index: answer.indexOf(marker), end_index: answer.indexOf(marker) + marker.length, url_citation: { title: 'Fixture source', url: 'https://example.test/docs' } }] } };
    const searchOutput = { content: JSON.stringify(structuredContent), structuredContent, detailedContent: 'redundant serialization' };
    const fetchUrl = 'https://example.test/docs/page';
    const fetchText = `Contents of ${fetchUrl}:\n# Page\n\n[Next page](next)\n\n<script>not executable</script>\n\n<note>Content truncated. Call the fetch tool with a start_index of 4000 to get more content.</note>`;
    await update([
      { sessionUpdate: 'tool_call', toolCallId: 'web-search', kind: 'search', title: 'Searching...', rawInput: { query: 'A full fixture query' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'web-search', status: 'completed', rawOutput: searchOutput, content: [{ type: 'content', content: { type: 'text', text: searchOutput.content } }] },
      { sessionUpdate: 'tool_call', toolCallId: 'web-fetch', kind: 'fetch', title: 'Fetch content from this URL.', rawInput: { url: fetchUrl } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'web-fetch', status: 'completed', rawOutput: { content: fetchText, detailedContent: fetchText }, content: [{ type: 'content', content: { type: 'text', text: fetchText } }] },
      { sessionUpdate: 'tool_call', toolCallId: 'web-failure', kind: 'fetch', title: 'Fetching...', rawInput: { url: 'https://example.test/missing' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'web-failure', status: 'failed', rawOutput: { code: 'failure', message: 'Failed to fetch — status code 404' } },
    ]);
    const search = page.locator('details[data-detail-key="tool:web-search"]');
    const fetch = page.locator('details[data-detail-key="tool:web-fetch"]');
    await expect(search.locator('.tool-card-title')).toHaveText('Web search');
    await expect(search.locator('.tool-card-preview')).toHaveText('A full fixture query');
    await expect(fetch.locator('.tool-card-preview')).toHaveText('example.test/docs/page');
    for (const card of [search, fetch]) await card.locator(':scope > summary').click();
    await expect(search.locator('.card-plugin-body strong')).toHaveText('Useful information');
    await expect(search.locator('[data-output-kind="web-sources"] a')).toHaveText('Fixture source');
    await expect(fetch.locator('[data-output-kind="fetch-partial"]')).toContainText('Content truncated');
    await expect(fetch.locator('.card-plugin-body script')).toHaveCount(0);
    const location = page.url();
    await search.locator('.card-plugin-body [data-output-kind="result"] a').click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_card_link').length).toBe(1);
    expect(demo.calls.find(call => call.command === 'open_card_link')!.args.href).toBe('https://example.test/docs');
    await fetch.locator('.card-plugin-body [data-output-kind="result"] a').click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_card_link').length).toBe(2);
    expect(demo.calls.filter(call => call.command === 'open_card_link')[1].args.href).toBe('https://example.test/docs/next');
    expect(page.url()).toBe(location);
    await search.locator(':scope > .tool-raw-output > summary').click();
    expect(await search.locator(':scope > .tool-raw-output pre').textContent()).toBe(searchOutput.content);
    await expect(page.locator('details[data-detail-key="tool:web-failure"] .tool-card-failed')).toHaveCount(1);
    await page.locator(visible('prompt')).fill('Offline permission fixture only');
    await page.locator(visible('prompt')).press('Enter');
    await expect(page.locator('.acp-permission')).toBeVisible();
    await packets([{ id: 'fetch-permission', method: 'session/request_permission', params: { sessionId: 'fixture-acp', toolCall: { toolCallId: 'fetch-approval', kind: 'fetch', title: 'Fetch content from this URL.', rawInput: { url: 'https://example.test/permission' } }, options: [{ optionId: 'deny-url', name: 'Deny', kind: 'reject_once' }] } }]);
    const permission = page.locator('.acp-permission').filter({ hasText: 'example.test/permission' });
    await expect(permission.locator('.acp-permission-summary')).toHaveText('Fetch · example.test/permission');
    await expect(permission.locator('.acp-permission-actions + .acp-permission-raw')).toHaveCount(1);
    await expect(permission.locator('.acp-permission-raw')).not.toHaveAttribute('open', '');
    expect(demo.calls.some(call => call.command === 'write_acp' && (call.args.message as { id?: string }).id === 'fetch-permission')).toBe(false);
    await permission.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(() => demo.calls.some(call => call.command === 'write_acp' && (call.args.message as { id?: string }).id === 'fetch-permission')).toBe(true);
    const reply = demo.calls.find(call => call.command === 'write_acp' && (call.args.message as { id?: string }).id === 'fetch-permission')!.args.message as { result: unknown };
    expect(reply.result).toEqual({ outcome: { outcome: 'selected', optionId: 'deny-url' } });
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
