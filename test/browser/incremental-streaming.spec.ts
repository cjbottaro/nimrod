import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('coalesced parallel outputs retain text/card identity and independent following/inspection', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const token = [...demo.children.keys()][0];
    const ids = ['incremental-a', 'incremental-b', 'incremental-untouched'];
    const emit = async (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value });
    }, { token, values });
    const source = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n');
    await emit([{ type: 'agent_start' }, ...ids.flatMap(id => [
      { type: 'tool_execution_start', toolCallId: id, toolName: 'bash', args: { command: id } },
      { type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: source }] } },
    ])]);
    for (const id of ids) {
      const card = page.locator(`details[data-detail-key="tool:${id}"]`);
      await expect(card.locator('.card-plugin-body .tool-output')).toContainText('Line 79');
      await card.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
    }
    await page.locator(visible('prompt')).focus();
    await page.evaluate(async ids => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const outputs = ids.map(id => document.querySelector<HTMLElement>(`details[data-detail-key="tool:${id}"] .card-plugin-body .tool-output`)!);
      outputs[0].scrollTop = 45; outputs[1].scrollTop = outputs[1].scrollHeight; outputs[2].scrollTop = 75;
      const state: { outputs: HTMLElement[]; text: ChildNode | null; mutations: number; observer: MutationObserver } = {
        outputs, text: outputs[0].firstChild, mutations: 0, observer: new MutationObserver(records => { state.mutations += records.length; }),
      };
      state.observer.observe(outputs[2].closest('details')!, { subtree: true, attributes: true, childList: true, characterData: true });
      (window as unknown as { incremental: typeof state }).incremental = state;
    }, ids);
    await emit([
      { type: 'tool_execution_update', toolCallId: ids[0], partialResult: { content: [{ type: 'text', text: source + '\nA1' }] } },
      { type: 'tool_execution_update', toolCallId: ids[1], partialResult: { content: [{ type: 'text', text: source + '\nB1' }] } },
      { type: 'tool_execution_update', toolCallId: ids[0], partialResult: { content: [{ type: 'text', text: source + '\nA1\nA2' }] } },
    ]);
    await expect(page.locator(`details[data-detail-key="tool:${ids[0]}"] .card-plugin-body .tool-output`)).toContainText('A2');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const actual = await page.evaluate(() => {
      const state = (window as unknown as { incremental: { outputs: HTMLElement[]; text: Node; mutations: number; observer: MutationObserver } }).incremental;
      state.observer.disconnect();
      return { sameText: state.outputs[0].firstChild === state.text, connected: state.outputs.every(output => output.isConnected), tops: state.outputs.map(output => output.scrollTop), following: state.outputs[1].scrollTop + state.outputs[1].clientHeight >= state.outputs[1].scrollHeight - 2, mutations: state.mutations };
    });
    expect(actual.sameText).toBe(true); expect(actual.connected).toBe(true);
    expect(actual.tops[0]).toBe(45); expect(actual.tops[2]).toBe(75); expect(actual.following).toBe(true); expect(actual.mutations).toBe(0);
    await expect(page.locator(visible('prompt'))).toBeFocused();
    await emit([{ type: 'tool_execution_end', toolCallId: ids[0], result: { content: [{ type: 'text', text: '\x1b[32mreplaced\r\x1b[2Kfinished' }] } }]);
    await expect(page.locator(`details[data-detail-key="tool:${ids[0]}"] .card-plugin-body .tool-output-final`)).toContainText('finished');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
