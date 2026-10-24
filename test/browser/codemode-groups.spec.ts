import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

test('codemode nests real child cards with independent inspected output and retained disclosures', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const token = [...demo.children.keys()][0];
    const emit = async (values: object[]) => page.evaluate(({ token, values }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (const value of values) channels[token].onmessage({ kind: 'rpc', value });
    }, { token, values });
    const output = Array.from({ length: 70 }, (_, i) => `line ${i}`).join('\n');
    await emit([
      { type: 'tool_execution_start', toolCallId: 'cm', toolName: 'codemode', args: { code: 'await tools.read({path:"a"});' } },
      { type: 'tool_execution_start', toolCallId: 'cm-child', parentToolCallId: 'cm', toolName: 'read', args: { path: 'a' } },
      { type: 'tool_execution_update', toolCallId: 'cm-child', parentToolCallId: 'cm', partialResult: { content: [{ type: 'text', text: output }] } },
      { type: 'tool_execution_update', toolCallId: 'cm', partialResult: { content: [{ type: 'text', text: output }] } },
    ]);
    const parent = page.locator('[data-detail-key="tool:cm"]');
    const child = parent.locator('[data-detail-key="tool:cm-child"]');
    await expect(parent.locator('.codemode-count')).toHaveText('0/1 calls');
    await parent.evaluate(node => { (node as HTMLDetailsElement).open = true; });
    await child.evaluate(node => { (node as HTMLDetailsElement).open = true; });
    const disclosure = parent.locator(':scope > .card-plugin-body > .card-output-disclosure');
    await disclosure.evaluate(node => { (node as HTMLDetailsElement).open = true; });
    const positions = await parent.evaluate(node => {
      const child = node.querySelector<HTMLElement>('.codemode-children .tool-output')!;
      const parent = node.querySelector<HTMLElement>(':scope > .card-plugin-body .tool-output')!;
      child.scrollTop = 35; parent.scrollTop = 65; child.focus();
      child.dataset.retained = 'yes'; parent.dataset.retained = 'yes';
      return [child.scrollTop, parent.scrollTop];
    });
    await emit([
      { type: 'tool_execution_update', toolCallId: 'cm-child', parentToolCallId: 'cm', partialResult: { content: [{ type: 'text', text: output + '\nchild more' }] } },
      { type: 'tool_execution_update', toolCallId: 'cm', partialResult: { content: [{ type: 'text', text: output + '\nparent more' }] } },
    ]);
    await expect(child.locator('.tool-output')).toContainText('child more');
    await expect(disclosure.locator('.tool-output')).toContainText('parent more');
    await expect(child.locator('.tool-output')).toBeFocused();
    expect(await child.locator('.tool-output').evaluate(node => node.scrollTop)).toBe(positions[0]);
    expect(await disclosure.locator('.tool-output').evaluate(node => node.scrollTop)).toBe(positions[1]);
    await expect(child.locator('.tool-output')).toHaveAttribute('data-retained', 'yes');
    await expect(disclosure.locator('.tool-output')).toHaveAttribute('data-retained', 'yes');
    await emit([
      { type: 'tool_execution_end', toolCallId: 'cm-child', parentToolCallId: 'cm', result: { content: [{ type: 'text', text: output + '\nchild final' }] } },
      { type: 'tool_execution_end', toolCallId: 'cm', result: { content: [{ type: 'text', text: output + '\nparent final' }] } },
      { type: 'agent_settled' },
    ]);
    await expect(parent.locator('.codemode-count')).toHaveText('1 call');
    await expect(parent.locator('.codemode-progress')).toBeHidden();
    await expect(child.locator('.tool-output')).toBeFocused();
    expect(await disclosure.evaluate(node => (node as HTMLDetailsElement).open)).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
