import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('queued stack anchors at the bottom of a short transcript and bounds long queues', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const queue = async (followUp: string[]) => page.evaluate(followUp => {
      const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
      channel.onmessage({ kind: 'rpc', value: { type: 'queue_update', steering: [], followUp } });
    }, followUp);
    const bounds = () => page.locator(visible('transcript-viewport')).evaluate(pane => {
      const stack = pane.querySelector('.queued-turns')!;
      const rect = stack.getBoundingClientRect(), viewport = pane.getBoundingClientRect();
      return { gap: viewport.bottom - rect.bottom, top: rect.top - viewport.top, overflow: stack.scrollHeight - stack.clientHeight };
    });
    await queue(['Short queue']);
    await expect(page.locator(visible('messages')).locator('.queued-turns .user')).toHaveCount(1);
    await expect.poll(async () => (await bounds()).gap).toBeLessThanOrEqual(25);
    await queue(Array.from({ length: 10 }, (_, i) => `Long queued message ${i}\n\n${'More content\n\n'.repeat(10)}`));
    await expect(page.locator(visible('messages')).locator('.queued-turns .user')).toHaveCount(11);
    await expect.poll(async () => (await bounds()).overflow).toBeGreaterThan(100);
    expect((await bounds()).top).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => (await bounds()).gap).toBeLessThanOrEqual(25);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

for (const readingHistory of [false, true]) test(`queued turns pin and reconcile while preserving ${readingHistory ? 'history reading' : 'bottom follow'}`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    // Drive deterministic queued work through the real ordered transport; no model.
    await page.evaluate(() => {
      const state = window as unknown as {
        __fixtureChannels: Record<string, { onmessage(packet: unknown): void }>;
        __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
      };
      const channel = Object.values(state.__fixtureChannels)[0];
      const emit = (value: unknown) => channel.onmessage({ kind: 'rpc', value });
      const invoke = state.__TAURI_INTERNALS__.invoke;
      const queue: string[] = [];
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const request = args?.message as { type?: string; id?: string; message?: string };
        if (command === 'write_pi' && request.type === 'prompt') {
          emit({ type: 'response', id: request.id, command: 'prompt', success: true });
          queue.push(request.message!);
          emit({ type: 'queue_update', steering: [], followUp: [...queue] });
          return;
        }
        return invoke(command, args);
      };
      emit({ type: 'agent_start' });
    });
    await expect(page.locator(visible('keyboard-hint'))).toContainText('Enter to steer');
    if (readingHistory) {
      await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
      await page.mouse.wheel(0, -180);
      await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    }
    const top = (await demo.metrics()).top;
    const prompt = page.locator(visible('prompt'));
    const messages = page.locator(visible('messages'));
    for (const text of ['Queued first', 'Queued second']) {
      await prompt.fill(text); await prompt.press('Alt+Enter');
    }
    const first = messages.locator('.message.user').filter({ hasText: 'Queued first' });
    const second = messages.locator('.message.user').filter({ hasText: 'Queued second' });
    await expect(messages.locator('.queued-turns .message')).toHaveCount(2);
    await expect(first.locator('.steering-status')).toHaveText('Queued');
    await first.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'queued-first'; });
    await expect(page.locator(visible('queue-activity'))).not.toContainText('Queued first');
    await prompt.fill('Newer draft');
    await expect(prompt).toBeFocused();
    const pinnedBounds = async () => page.locator(visible('transcript-viewport')).evaluate(pane => {
      const stack = pane.querySelector('.queued-turns')!.getBoundingClientRect();
      const bounds = pane.getBoundingClientRect();
      return { bottomGap: bounds.bottom - stack.bottom, topGap: stack.top - bounds.top };
    });
    await expect.poll(async () => (await pinnedBounds()).bottomGap).toBeLessThanOrEqual(25);
    expect((await pinnedBounds()).topGap).toBeGreaterThanOrEqual(0);
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - top)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);

    // Streaming growth must remain above the stack without pulling a history reader.
    await page.evaluate(() => {
      const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
      channel.onmessage({ kind: 'rpc', value: { type: 'message_end', message: { role: 'assistant', timestamp: 123456, content: 'Streaming growth\n\n'.repeat(30) } } });
    });
    await expect(messages).toContainText('Streaming growth');
    await expect.poll(async () => (await pinnedBounds()).bottomGap).toBeLessThanOrEqual(25);
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - top)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.evaluate(() => {
      const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
      const emit = (value: unknown) => channel.onmessage({ kind: 'rpc', value });
      emit({ type: 'queue_update', steering: [], followUp: ['Queued second'] });
      emit({ type: 'message_end', message: { role: 'user', timestamp: 123457, content: 'Queued first' } });
    });
    await expect(messages.locator('.queued-turns .message')).toHaveCount(1);
    await expect(first).toHaveAttribute('data-test-identity', 'queued-first');
    await expect(first.locator('.steering-status')).toHaveCount(0);
    await expect(first).not.toHaveClass(/sticky-turn/);
    await expect(second).toHaveClass(/sticky-turn/);
    await expect(prompt).toHaveValue('Newer draft'); await expect(prompt).toBeFocused();
    if (readingHistory) expect(Math.abs((await demo.metrics()).top - top)).toBeLessThanOrEqual(2);
    else await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
