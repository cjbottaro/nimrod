import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('offline legacy Copilot ACP cards keep compact previews, exact raw recovery and inspected output', async ({ page }) => {
  const state = { [`nimrod.tabs.v1:${process.cwd()}`]: { tabs: [{ kind: 'acp', profile: 'copilot', sessionId: 'fixture-acp', name: 'Legacy Copilot cards' }] } };
  const demo = await demoFixture(page, state, [], undefined, undefined, { acpAgentName: 'Copilot' });
  try {
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Legacy Copilot cards' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    const connection = demo.calls.find(call => call.command === 'write_acp' && (call.args.message as { method?: string }).method === 'session/load')!;
    const token = connection.args.token as string;
    const project = (demo.calls.find(call => call.command === 'start_acp' && call.args.token === token)!.args.config as { cwd: string }).cwd;
    const emit = (updates: object[]) => page.evaluate(({ token, updates }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const update of updates) channels[token].onmessage({ kind: 'rpc', value: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'fixture-acp', update } } });
    }, { token, updates });
    const content = Array.from({ length: 80 }, (_, index) => `line ${index}: <script>literal source</script>`).join('\n');
    const rawOutput = { content, detailedContent: 'redundant diff representation' };
    await emit([
      { sessionUpdate: 'tool_call', toolCallId: 'read-fixture', kind: 'read', title: 'Viewing .../client.ts', status: 'in_progress', rawInput: { path: `${project}/src/client.ts`, view_range: [1, 80] } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'read-fixture', rawOutput },
      { sessionUpdate: 'tool_call', toolCallId: 'search-fixture', kind: 'other', title: "Searching for 'deleteSession...'", rawInput: { pattern: 'deleteSession|session/delete', paths: `${project}/src`, glob: '*.ts', output_mode: 'content' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 'search-fixture', status: 'completed', rawOutput: { content: 'client.ts:20: deleteSession', detailedContent: 'same search in another format' } },
      { sessionUpdate: 'tool_call', toolCallId: 'outside-fixture', kind: 'read', title: 'Read outside project', status: 'completed', rawInput: { path: `${project}-sibling/client.ts`, view_range: [2, 4] } },
    ]);
    const read = page.locator('details[data-detail-key="tool:read-fixture"]');
    const search = page.locator('details[data-detail-key="tool:search-fixture"]');
    await expect(read.locator('.tool-card-title')).toHaveText('Read file');
    await expect(read.locator('.tool-card-preview')).toHaveText('src/client.ts · lines 1–80');
    await expect(search.locator('.tool-card-title')).toHaveText('Search');
    await expect(search.locator('.tool-card-preview')).toHaveText('deleteSession|session/delete · in src · files *.ts');
    await expect(page.locator('details[data-detail-key="tool:outside-fixture"] .tool-card-preview')).toHaveText(`${project}-sibling/client.ts · lines 2–4`);
    await read.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    const output = read.locator('.card-plugin-body [data-output-kind="result"] .tool-output');
    expect(await output.textContent()).toBe(content);
    await expect(read.locator('script')).toHaveCount(0);
    const position = await output.evaluate(node => { const output = node as HTMLElement; output.scrollTop = 35; output.focus(); output.dataset.fixtureIdentity = 'read-output'; return output.scrollTop; });
    const final = { content: content + '\nfinal line', detailedContent: 'final redundant representation' };
    await emit([{ sessionUpdate: 'tool_call_update', toolCallId: 'read-fixture', status: 'completed', rawOutput: final }]);
    await expect(output).toHaveAttribute('data-fixture-identity', 'read-output');
    await expect(output).toHaveClass(/tool-output-final/);
    await expect(output).toBeFocused();
    expect(await output.evaluate(node => node.scrollTop)).toBe(position);
    expect(await output.textContent()).toBe(final.content);
    const raw = read.locator(':scope > .tool-raw-output');
    await raw.locator(':scope > summary').click();
    expect(await raw.locator('[data-output-kind="result"] pre').textContent()).toBe(JSON.stringify(final, null, 2));
    await search.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    await expect(search.locator('.card-plugin-body .tool-output')).toHaveText('client.ts:20: deleteSession');
    expect(demo.errors).toEqual([]);
    expect(demo.calls.some(call => call.command === 'write_acp' && (call.args.message as { method?: string }).method === 'session/prompt')).toBe(false);
  } finally { await demo.close(); }
});
