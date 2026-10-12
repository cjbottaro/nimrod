import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { demoFixture, visible } from './demo-fixture';
import { searchText, fetchedText, storedText, checkText } from '../fixtures/pi-web-access';

async function pluginBundle() {
  const result = await build({ entryPoints: ['plugins/pi-web-access.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
  return { entries: ['pi-web-access.ts'], plugins: [{ entry: 'pi-web-access.ts', source: result.outputFiles[0].text, cacheHit: true }], warnings: [] };
}
async function events(page: Page, values: Record<string, unknown>[]) {
  await page.evaluate(values => {
    const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
    const channel = Object.values(channels)[0]; values.forEach(value => channel.onmessage({ kind: 'rpc', value }));
  }, values);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function result(page: Page, id: string, name: string, args: Record<string, unknown>, text: string, timestamp: number) {
  await events(page, [
    { type: 'message_start', message: { role: 'assistant', timestamp, content: [{ type: 'toolCall', id, name, arguments: args }] } },
    { type: 'tool_execution_start', toolCallId: id, toolName: name, args },
    { type: 'tool_execution_end', toolCallId: id, toolName: name, result: { content: [{ type: 'text', text }] }, isError: false },
    { type: 'message_end', message: { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }] } },
    { type: 'agent_settled' },
  ]);
}

test('pi-web-access personal plugin renders search sources and native presentation actions without executing web tools', async ({ page }) => {
  const prepared = await pluginBundle();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: async () => prepared }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toContainText('1 personal');
    await result(page, 'web-1', 'web_search', { queries: ['TypeScript DOM plugins', 'TypeScript cache'] }, searchText, 100);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'Web search' }) }).first();
    await expect(card.locator('summary').first()).toContainText('TypeScript DOM plugins'); await card.locator('summary').first().click();
    const sources = card.locator('[aria-label="Web access source links"]'); await expect(sources.locator('a')).toHaveCount(3);
    await sources.getByRole('link', { name: 'DOM lifecycle guide' }).click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_card_link').length).toBe(1);
    expect(demo.calls.find(call => call.command === 'open_card_link')?.args.href).toBe('https://docs.example.test/dom');
    const prompt = page.locator(visible('prompt')); await prompt.fill('keep draft');
    const copy = card.getByRole('button', { name: 'Copy returned text', exact: true }); await copy.focus(); await copy.press('Enter');
    await expect(card.getByRole('status')).toHaveText('Copied returned text'); await expect(copy).toBeFocused(); await expect(prompt).toHaveValue('keep draft');
    expect(demo.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)?.args.text).toBe(searchText);
    await card.getByRole('button', { name: 'Copy response ID' }).click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)?.args.text).toBe('search_fixture');
    await card.getByRole('button', { name: 'Pop out returned text' }).click();
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_code_popout').length).toBe(1);
    await expect(card.locator('.tool-raw-output')).toContainText('search_fixture');
    expect(demo.calls.some(call => call.command === 'write_pi' && (call.args.message as { type?: string })?.type === 'prompt')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('running web progress keeps the transcript tail compact while auto-disclosure and streaming continue', async ({ page }) => {
  await page.setViewportSize({ width: 1650, height: 1065 });
  const prepared = await pluginBundle();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: async () => prepared }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toContainText('1 personal');
    await demo.turn(1); await demo.turn(2);
    await events(page, [
      { type: 'agent_start' },
      { type: 'message_start', message: { role: 'assistant', timestamp: 200, content: [{ type: 'toolCall', id: 'running-web', name: 'web_search', arguments: { queries: ['first query', 'second query'], workflow: 'none' } }] } },
      { type: 'tool_execution_start', toolCallId: 'running-web', toolName: 'web_search', args: { queries: ['first query', 'second query'], workflow: 'none' } },
      { type: 'tool_execution_update', toolCallId: 'running-web', toolName: 'web_search', partialResult: { content: [{ type: 'text', text: 'Searching first query (0/2 complete)...' }] } },
    ]);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'Web search' }) }).last();
    await expect(card).toHaveAttribute('open', '');
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    const geometry = () => page.locator(visible('transcript-viewport')).evaluate(pane => {
      const messages = pane.querySelector<HTMLElement>('[data-pi-id="messages"]')!;
      const card = messages.lastElementChild!;
      return { tail: pane.getBoundingClientRect().bottom - messages.getBoundingClientRect().bottom, cardHeight: card.getBoundingClientRect().height, viewportHeight: pane.getBoundingClientRect().height,
        blocks: Array.from(card.querySelectorAll<HTMLElement>('section, [role="status"], .tool-raw-output'), node => ({ tag: node.tagName, text: node.textContent?.slice(0, 80), hidden: node.hidden, height: node.getBoundingClientRect().height, display: getComputedStyle(node).display })) };
    });
    const before = await geometry();
    expect(before.tail).toBeLessThanOrEqual(50);
    await expect(card.locator('.pi-web-access')).toHaveCount(0);
    await expect(card.locator('.tool-raw-output')).toHaveCount(0);
    await expect(card.locator('.tool-output')).toHaveCount(1);
    await expect(card.locator('.card-plugin-body .tool-output')).toHaveText('Searching first query (0/2 complete)...');
    expect(before.cardHeight).toBeLessThan(200); // One live line + core summary/raw-input disclosure at 125% zoom.
    const placement = await page.locator(visible('transcript-viewport')).evaluate(pane => ({ left: pane.scrollLeft, x: pane.getBoundingClientRect().left, childX: pane.firstElementChild!.getBoundingClientRect().left }));
    expect(placement.left).toBe(0); expect(placement.childX).toBe(placement.x);
    await events(page, [{ type: 'tool_execution_update', toolCallId: 'running-web', toolName: 'web_search', partialResult: { content: [{ type: 'text', text: 'Completed 1/2 searches.' }] } }]);
    await expect.poll(async () => (await geometry()).tail).toBeLessThanOrEqual(50);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('long code-block results cannot inflate the transcript scroll range beyond its laid-out content', async ({ page }) => {
  await page.setViewportSize({ width: 1650, height: 1065 });
  const prepared = await pluginBundle();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: async () => prepared }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toContainText('1 personal'); await demo.turn(1); await demo.turn(2);
    const args = { query: 'long code output' };
    await events(page, [
      { type: 'agent_start' },
      { type: 'message_start', message: { role: 'assistant', timestamp: 210, content: [{ type: 'toolCall', id: 'long-web', name: 'web_search', arguments: args }] } },
      { type: 'tool_execution_start', toolCallId: 'long-web', toolName: 'web_search', args },
      { type: 'tool_execution_update', toolCallId: 'long-web', toolName: 'web_search', partialResult: { content: [{ type: 'text', text: 'Searching...' }] } },
    ]);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'Web search' }) }).last();
    await expect(card).toHaveAttribute('open', '');
    const text = Array.from({ length: 16 }, (_, i) => `## Section ${i}\n\nA retained explanation.\n\n\`\`\`ts\n${Array.from({ length: 10 }, (_, n) => `const value${n} = ${n};`).join('\n')}\n\`\`\``).join('\n\n');
    await events(page, [
      { type: 'tool_execution_end', toolCallId: 'long-web', toolName: 'web_search', result: { content: [{ type: 'text', text }] }, isError: false },
      { type: 'message_end', message: { role: 'toolResult', toolCallId: 'long-web', toolName: 'web_search', content: [{ type: 'text', text }] } },
    ]);
    await expect(card.locator('.code-block')).toHaveCount(16);
    const geometry = await page.locator(visible('transcript-viewport')).evaluate(pane => ({
      scrollHeight: pane.scrollHeight, contentHeight: (pane.firstElementChild as HTMLElement).offsetHeight,
      statusParents: Array.from(pane.querySelectorAll<HTMLElement>('.pi-web-access .code-copy-status'), node => node.offsetParent?.className),
      lastBottom: pane.querySelector('[data-pi-id="messages"]')!.lastElementChild!.getBoundingClientRect().bottom, top: pane.getBoundingClientRect().top,
    }));
    expect(geometry.statusParents.every(parent => String(parent).includes('tool-output'))).toBe(true);
    expect(geometry.scrollHeight - geometry.contentHeight).toBeLessThanOrEqual(2);
    expect(geometry.lastBottom).toBeGreaterThan(geometry.top);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('fetch/stored/source-check render through the same external source with safe links and independent mounted cards', async ({ page }) => {
  const prepared = await pluginBundle();
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{}', packages: {}, personal: async () => prepared }, { enforceCsp: true });
  try {
    await expect(page.locator('#card-plugin-status')).toContainText('1 personal');
    await result(page, 'fetch-1', 'fetch_content', { url: 'https://docs.example.test/guide/' }, fetchedText, 101);
    await result(page, 'stored-1', 'get_search_content', { responseId: 'stored', queryIndex: 0 }, storedText, 102);
    await result(page, 'check-1', 'source_check', { claim: 'Example claim' }, checkText, 103);
    const cards = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.pi-web-access') }); await expect(cards).toHaveCount(3);
    const fetch = cards.nth(0); await fetch.locator('summary').first().click();
    await expect(fetch.locator('[aria-label="Web access returned content"] strong')).toContainText('readable');
    await expect(fetch.getByRole('link', { name: 'local guidance' })).toHaveAttribute('href', 'https://docs.example.test/guide/next');
    const stored = cards.nth(1); await stored.locator('summary').first().click(); await expect(stored.locator('[aria-label="Web access source links"] a')).toHaveCount(2);
    const check = cards.nth(2); await check.locator('summary').first().click(); await expect(check.locator('[aria-label="Web access returned content"]')).toContainText('needs_review');
    await expect(check.locator('summary').first()).toContainText('Example claim'); await expect(fetch).toHaveAttribute('open', ''); await expect(stored).toHaveAttribute('open', '');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
