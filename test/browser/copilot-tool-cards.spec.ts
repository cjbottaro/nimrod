import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';
import { copilotToolResult } from '../../src/copilot/tool-result';

test('offline Copilot cards keep compact previews, exact raw recovery and inspected output', async ({ page }) => {
  const state = { [`nimrod.tabs.v1:${process.cwd()}`]: { tabs: [{ kind: 'copilot-sdk', sessionId: 'fixture-sdk', name: 'Copilot cards' }] } };
  const demo = await demoFixture(page, state);
  try {
    await page.locator('#open-sessions .session-row').filter({ hasText: 'Copilot cards' }).click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    const connection = demo.calls.find(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'connect')!;
    const token = connection.args.token as string;
    const project = (demo.calls.find(call => call.command === 'start_copilot' && call.args.token === token)!.args.config as { cwd: string }).cwd;
    const emit = (updates: { type: string; data: object }[]) => page.evaluate(({ token, updates }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const event of updates) channels[token].onmessage({ kind: 'rpc', value: { kind: 'event', event: { id: crypto.randomUUID(), ...event } } });
    }, { token, updates });
    const content = Array.from({ length: 80 }, (_, index) => `line ${index}: <script>literal source</script>`).join('\n');
    const rawOutput = { content, detailedContent: 'redundant diff representation' };
    await emit([
      { type: 'tool.execution_start', data: { toolCallId: 'read-fixture', toolName: 'view', toolTitle: 'Viewing .../client.ts', arguments: { path: `${project}/src/client.ts`, view_range: [1, 80] } } },
      { type: 'tool.execution_partial_result', data: { toolCallId: 'read-fixture', partialOutput: rawOutput.content } },
      { type: 'tool.execution_start', data: { toolCallId: 'search-fixture', toolName: 'grep', arguments: { pattern: 'deleteSession|session/delete', paths: `${project}/src`, glob: '*.ts', output_mode: 'content' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'search-fixture', success: true, result: { content: 'client.ts:20: deleteSession', detailedContent: 'same search in another format' } } },
      { type: 'tool.execution_start', data: { toolCallId: 'outside-fixture', toolName: 'view', arguments: { path: `${project}-sibling/client.ts`, view_range: [2, 4] } } },
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
    await emit([{ type: 'tool.execution_complete', data: { toolCallId: 'read-fixture', success: true, result: final } }]);
    await expect(output).toHaveAttribute('data-fixture-identity', 'read-output');
    await expect(output).toHaveClass(/tool-output-final/);
    await expect(output).toBeFocused();
    expect(await output.evaluate(node => node.scrollTop)).toBe(position);
    expect(await output.textContent()).toBe(final.content);
    const raw = read.locator(':scope > .tool-raw-output');
    await raw.locator(':scope > summary').click();
    expect(await raw.locator('[data-output-kind="result"] pre').textContent()).toBe(copilotToolResult(final));
    await search.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    await expect(search.locator('.card-plugin-body .tool-output')).toHaveText('client.ts:20: deleteSession');
    expect(demo.errors).toEqual([]);
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'prompt')).toBe(false);
  } finally { await demo.close(); }
});
