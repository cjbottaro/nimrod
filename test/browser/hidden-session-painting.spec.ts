import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

for (const follow of [false, true]) test(`hidden streaming leaves transcript DOM untouched and catches up with retained inspection (follow: ${follow})`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const panel = (await page.locator('.session-view').getAttribute('id'))!;
    const token = [...demo.children.keys()][0];
    const row = page.locator(`.session-row[aria-controls="${panel}"]`);
    const ids = ['hidden-output-one', 'hidden-output-two'];
    const output = '\x1b[32m' + Array.from({ length: 70 }, (_, i) => `Original line ${i}`).join('\n') + '\x1b[0m';
    await page.evaluate(({ token, ids, output }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      const emit = (value: object) => channels[token].onmessage({ kind: 'rpc', value });
      emit({ type: 'agent_start' });
      for (const id of ids) {
        emit({ type: 'tool_execution_start', toolCallId: id, toolName: 'bash', args: { command: id } });
        emit({ type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: output }] } });
      }
    }, { token, ids, output });
    const cards = ids.map(id => page.locator(`#${panel} details[data-detail-key="tool:${id}"]`));
    for (const card of cards) {
      await expect(card).toBeVisible();
      await card.evaluate(node => { if (!(node as HTMLDetailsElement).open) node.querySelector('summary')!.click(); });
      await expect(card).toHaveAttribute('open', '');
    }
    const pane = page.locator(visible('transcript-viewport'));
    await pane.hover(); await page.mouse.wheel(0, follow ? 10000 : -10000);
    if (follow) await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const reading = (await demo.metrics()).top;
    await page.evaluate(({ panel, ids }) => {
      const root = document.getElementById(panel)!;
      const retained = ids.map((id, i) => {
        const card = root.querySelector<HTMLDetailsElement>(`details[data-detail-key="tool:${id}"]`)!;
        const output = card.querySelector<HTMLElement>('.tool-output-streaming')!;
        output.scrollTop = 31 + i * 30;
        return { card, output, top: output.scrollTop };
      });
      Object.assign(window, { hiddenRetained: retained });
    }, { panel, ids });
    await page.locator(visible('prompt')).fill('First retained draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('new temporary session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('.session-row')).toHaveCount(2);
    await expect(page.locator(`#${panel}`)).toBeHidden();
    await page.locator(visible('prompt')).fill('Second retained draft');
    const secondPrompt = page.locator(visible('prompt'));
    await secondPrompt.focus();
    const mutations = await page.evaluate(async ({ panel, token, ids, output }) => {
      const messages = document.getElementById(panel)!.querySelector('[data-pi-id="messages"]')!;
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(messages, { subtree: true, childList: true, attributes: true, characterData: true });
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      for (let i = 0; i < 20; i++) for (const id of ids) channels[token].onmessage({ kind: 'rpc', value: {
        type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: `${output}\nLatest hidden ${i}` }] },
      } });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      observer.disconnect();
      return mutations;
    }, { panel, token, ids, output });
    expect(mutations).toBe(0);
    await expect(secondPrompt).toBeFocused();
    await expect(secondPrompt).toHaveValue('Second retained draft');
    await expect(row).toHaveAttribute('aria-label', /Working/);
    await row.click();
    await expect(page.locator(visible('prompt'))).toHaveValue('First retained draft');
    for (const card of cards) await expect(card).toContainText('Latest hidden 19');
    expect(await page.evaluate(() => {
      const retained = (window as unknown as { hiddenRetained: { card: HTMLDetailsElement; output: HTMLElement; top: number }[] }).hiddenRetained;
      return retained.map(({ card, output, top }) => ({ connected: card.isConnected && output.isConnected, open: card.open, gap: Math.abs(output.scrollTop - top) }));
    })).toEqual([{ connected: true, open: true, gap: 0 }, { connected: true, open: true, gap: 0 }]);
    if (follow) await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    else await expect.poll(async () => Math.abs((await demo.metrics()).top - reading)).toBeLessThanOrEqual(2);
    // Repeat selection without new events: no stale replay or loss of local state.
    await page.locator(`.session-row:not([aria-controls="${panel}"])`).click();
    await expect(page.locator(visible('prompt'))).toHaveValue('Second retained draft');
    await row.click();
    for (const card of cards) await expect(card).toContainText('Latest hidden 19');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
