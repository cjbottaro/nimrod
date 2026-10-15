import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('dedicated write plugin keeps requested content and streaming results independently readable', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const token = [...demo.children.keys()][0];
    const id = 'builtin-write-fixture';
    const content = '<img src=x onerror=bad>\n' + Array.from({ length: 70 }, (_, i) => `Requested line ${i}`).join('\n');
    const live = Array.from({ length: 70 }, (_, i) => `Progress line ${i}`).join('\n');
    const emit = async (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value });
    }, { token, values });
    await emit([
      { type: 'agent_start' },
      { type: 'tool_execution_start', toolCallId: id, toolName: 'functions.write', args: { path: 'src/requested.ts', content } },
      { type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: live }] } },
    ]);
    const card = page.locator(`details[data-detail-key="tool:${id}"]`);
    await expect(card.locator('.tool-card-preview')).toHaveText('src/requested.ts');
    await card.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    const requested = card.locator('[data-output-kind="requested-content"] .tool-output');
    const output = card.locator('[data-output-kind="result"] .tool-output');
    expect(await requested.textContent()).toBe(content);
    await expect(card.locator('img')).toHaveCount(0);
    const positions = await card.evaluate(node => {
      const requested = node.querySelector<HTMLElement>('[data-output-kind="requested-content"] .tool-output')!;
      const output = node.querySelector<HTMLElement>('[data-output-kind="result"] .tool-output')!;
      requested.dataset.fixtureIdentity = 'requested'; output.dataset.fixtureIdentity = 'output';
      requested.scrollTop = 35; output.scrollTop = 60; requested.focus();
      return [requested.scrollTop, output.scrollTop];
    });
    await emit([{ type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: live + '\nmore progress' }] } }]);
    await expect(output).toContainText('more progress');
    await expect(requested).toBeFocused();
    await emit([{ type: 'tool_execution_end', toolCallId: id, toolName: 'functions.write', result: { content: [{ type: 'text', text: live + '\nfinal result' }] }, isError: false }]);
    await expect(output).toContainText('final result');
    await expect(requested).toHaveAttribute('data-fixture-identity', 'requested');
    await expect(output).toHaveAttribute('data-fixture-identity', 'output');
    await expect(requested).toBeFocused();
    await expect(output).toHaveClass(/tool-output-final/);
    expect(await requested.textContent()).toBe(content);
    expect(await requested.evaluate(node => node.scrollTop)).toBe(positions[0]);
    expect(await output.evaluate(node => node.scrollTop)).toBe(positions[1]);
    expect(await requested.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await output.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await card.evaluate(node => (node as HTMLDetailsElement).open)).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
