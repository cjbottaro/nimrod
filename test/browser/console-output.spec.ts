import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('console-style live and final output retains selectable text, raw bytes and independent inspection', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const token = [...demo.children.keys()][0];
    const ids = ['ansi-output-one', 'ansi-output-two'];
    const source = '\x1b[32m' + Array.from({ length: 60 }, (_, i) => `Line ${i}`).join('\n') + '\nprogress 10%';
    const emit = async (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value });
    }, { token, values });
    await emit([
      { type: 'agent_start' },
      ...ids.flatMap(id => [
        { type: 'tool_execution_start', toolCallId: id, toolName: 'bash', args: { command: id } },
        { type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: source }] } },
      ]),
    ]);
    const cards = ids.map(id => page.locator(`details[data-detail-key="tool:${id}"]`));
    for (const card of cards) {
      await card.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
      await expect(card.locator('.card-plugin-body .tool-output')).toContainText('progress 10%');
    }
    await page.locator(visible('prompt')).focus();
    const positions = await page.evaluate(ids => ids.map((id, i) => {
      const output = document.querySelector<HTMLElement>(`details[data-detail-key="tool:${id}"] .card-plugin-body .tool-output`)!;
      output.scrollTop = 30 + i * 30;
      return output.scrollTop;
    }), ids);
    const updated = `${source}\r\x1b[2K\x1b[1mprogress 90%\x1b[0m`;
    await emit([{ type: 'tool_execution_update', toolCallId: ids[0], partialResult: { content: [{ type: 'text', text: updated }] } }]);
    const output = cards[0].locator('.card-plugin-body .tool-output');
    await expect(output).toContainText('progress 90%');
    expect(await output.textContent()).not.toContain('\x1b');
    await expect(page.locator(visible('prompt'))).toBeFocused();
    expect(await output.locator('.console-output-line').first().locator('span').evaluate(node => getComputedStyle(node).color)).not.toBe('');
    for (let i = 0; i < cards.length; i++) expect(await cards[i].locator('.card-plugin-body .tool-output').evaluate(node => node.scrollTop)).toBe(positions[i]);
    const final = `${updated}\ndone`;
    await emit([{ type: 'tool_execution_end', toolCallId: ids[0], toolName: 'bash', result: { content: [{ type: 'text', text: final }] }, isError: false }]);
    await expect(cards[0].locator('.card-plugin-body [data-output-kind="result"] .tool-output-final')).toContainText('done');
    expect(await cards[0].locator('.card-plugin-body [data-output-kind="result"] .tool-output').evaluate(node => node.scrollTop)).toBe(positions[0]);
    const raw = cards[0].locator(':scope > .tool-raw-output');
    await raw.locator(':scope > summary').click();
    expect(await raw.locator('[data-output-kind="result"] pre').textContent()).toBe(final);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
