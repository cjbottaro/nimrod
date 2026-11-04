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
    await emit([{ type: 'assistant.tool_call_delta', data: { toolCallId: 'read-fixture', inputDelta: '{"path":' } }]);
    await page.locator('details[data-detail-key="tool:read-fixture"]').evaluate(node => { (node as HTMLElement).dataset.fixtureIdentity = 'generated'; });
    await emit([
      { type: 'tool.execution_start', data: { toolCallId: 'read-fixture', toolName: 'view', toolTitle: 'Viewing .../client.ts', arguments: { path: `${project}/src/client.ts`, view_range: [1, 80] } } },
      { type: 'tool.execution_partial_result', data: { toolCallId: 'read-fixture', partialOutput: rawOutput.content } },
      { type: 'tool.execution_start', data: { toolCallId: 'search-fixture', toolName: 'rg', arguments: { pattern: 'deleteSession|session/delete', paths: `${project}/src`, glob: '*.ts', output_mode: 'content' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'search-fixture', success: true, result: { content: 'client.ts:20: deleteSession', detailedContent: 'same search in another format' } } },
      { type: 'tool.execution_start', data: { toolCallId: 'outside-fixture', toolName: 'view', arguments: { path: `${project}-sibling/client.ts`, view_range: [2, 4] } } },
    ]);
    const read = page.locator('details[data-detail-key="tool:read-fixture"]');
    const search = page.locator('details[data-detail-key="tool:search-fixture"]');
    await expect(read).toHaveAttribute('data-fixture-identity', 'generated');
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
    const failure = { code: 'failure', message: 'Fixture permission failure, not a cancellation' };
    const githubResult = { content: 'preview', detailedContent: 'full native serialization', structuredContent: { total_count: 5, incomplete_results: true,
      items: [{ path: 'src/remote.ts', text_matches: [{ fragment: '<script>literal snippet</script>' }] }] } };
    await emit([
      { type: 'tool.execution_start', data: { toolCallId: 'failed-fetch', toolName: 'web_fetch', arguments: { url: 'https://example.test/file' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'failed-fetch', success: false, error: failure } },
      { type: 'tool.execution_start', data: { toolCallId: 'github-search', toolName: 'github-mcp-server-search_code', mcpServerName: 'github-mcp-server', mcpToolName: 'search_code', arguments: { query: 'repo:owner/repo fixture' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'github-search', success: true, result: githubResult } },
    ]);
    const failed = page.locator('details[data-detail-key="tool:failed-fetch"]');
    await failed.locator(':scope > summary').click();
    await expect(failed.locator('.card-plugin-body .tool-output')).toHaveText(failure.message);
    await expect(failed.locator('.tool-card-failed')).toHaveCount(1);
    const github = page.locator('details[data-detail-key="tool:github-search"]');
    await expect(github.locator('.tool-card-title')).toHaveText('GitHub code search');
    await expect(github.locator('.tool-card-preview')).toHaveText('repo:owner/repo fixture');
    await github.locator(':scope > summary').click();
    await expect(github.locator('.card-plugin-body .tool-output')).toContainText('1 of 5 results returned');
    await expect(github.locator('.card-plugin-body .tool-output')).toContainText('<script>literal snippet</script>');
    await expect(github.locator('script')).toHaveCount(0);
    await github.locator(':scope > .tool-raw-output > summary').click();
    expect(await github.locator(':scope > .tool-raw-output pre').textContent()).toBe(copilotToolResult(githubResult));
    const shellText = Array.from({ length: 60 }, (_, index) => `line ${index}: ${'x'.repeat(240)}`).join('\n');
    const colored = `\x1b[32m${shellText}\x1b[0m`;
    await emit([
      { type: 'tool.execution_start', data: { toolCallId: 'shell-fixture', toolName: 'bash', toolTitle: 'Running command', arguments: { command: 'fixture command' } } },
      { type: 'tool.shell_output', data: { toolCallId: 'shell-fixture', sequence: 0, stream: 'stdout', text: colored } },
      { type: 'tool.execution_partial_result', data: { toolCallId: 'shell-fixture', partialOutput: shellText } },
    ]);
    const shell = page.locator('details[data-detail-key="tool:shell-fixture"]');
    await shell.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    const consoleOutput = shell.locator('.card-plugin-body .tool-output');
    await expect(consoleOutput).toHaveCount(1);
    await expect(shell.locator('.card-plugin-body .tool-label')).toBeHidden();
    expect(await consoleOutput.textContent()).toBe(shellText);
    const geometry = () => consoleOutput.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth, wrap: getComputedStyle(node).whiteSpace }));
    expect(await geometry()).toMatchObject({ wrap: 'pre-wrap' });
    expect((await geometry()).content).toBeLessThanOrEqual((await geometry()).width + 1);
    expect(await consoleOutput.locator('.console-output-line > span').first().evaluate(node => getComputedStyle(node).color))
      .not.toBe(await consoleOutput.evaluate(node => getComputedStyle(node).color));
    const shellPosition = await consoleOutput.evaluate(node => {
      const output = node as HTMLElement; output.scrollTop = 40; output.focus(); output.dataset.fixtureIdentity = 'shell-output'; return output.scrollTop;
    });
    const shellFinal = { content: 'preview\n<shellId: 9 completed with exit code 0>', contents: [
      { type: 'shell_exit', shellId: '9', exitCode: 0, outputPreview: 'preview', cwd: project },
    ] };
    await emit([{ type: 'tool.execution_complete', data: { toolCallId: 'shell-fixture', success: true, result: shellFinal } }]);
    await expect(consoleOutput).toHaveAttribute('data-fixture-identity', 'shell-output');
    await expect(consoleOutput).toBeFocused();
    expect(await consoleOutput.evaluate(node => node.scrollTop)).toBe(shellPosition);
    expect(await consoleOutput.textContent()).toBe(shellText);
    const shellRaw = shell.locator(':scope > .tool-raw-output');
    await expect(shellRaw).not.toHaveAttribute('open', '');
    expect(await shell.locator(':scope > .card-plugin-body + .tool-raw-inputs + .tool-raw-output').count()).toBe(1);
    await page.setViewportSize({ width: 800, height: 900 });
    expect((await geometry()).content).toBeLessThanOrEqual((await geometry()).width + 1);
    await shellRaw.locator(':scope > summary').click();
    expect(await shellRaw.locator('[data-output-kind="execution"] pre').textContent()).toBe(colored);
    expect(await shellRaw.locator('[data-output-kind="result"] pre').textContent()).toBe(copilotToolResult(shellFinal));
    expect(demo.errors).toEqual([]);
    expect(demo.calls.some(call => call.command === 'write_copilot' && (call.args.message as { method?: string }).method === 'prompt')).toBe(false);
  } finally { await demo.close(); }
});
