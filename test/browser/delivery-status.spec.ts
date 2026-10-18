import { expect, test, type Locator } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

async function expectHeaderTypography(label: Locator) {
  const typography = await label.evaluate(node => {
    // .label retains the exact typography of the historical TOOL: BASH header.
    const reference = document.createElement('div'); reference.className = 'label';
    reference.textContent = node.textContent;
    node.closest('.message')!.append(reference);
    try {
      const span = getComputedStyle(node), original = getComputedStyle(reference);
      const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform'] as const;
      return {
        fields: properties.map(property => ({ property, span: span[property], original: original[property] })),
        family: span.fontFamily, uiFamily: getComputedStyle(document.documentElement).fontFamily,
        size: parseFloat(span.fontSize), spacing: parseFloat(span.letterSpacing), transform: span.textTransform,
      };
    } finally { reference.remove(); }
  });
  for (const field of typography.fields) expect(field.span, field.property).toBe(field.original);
  expect(typography.family).toBe(typography.uiFamily);
  expect(typography.transform).toBe('uppercase');
  expect(typography.spacing).toBeCloseTo(typography.size * 0.05, 3);
}

async function queuedStatus(page: Parameters<typeof demoFixture>[0]) {
  await page.evaluate(() => {
    const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
    channel.onmessage({ kind: 'rpc', value: { type: 'queue_update', steering: [], followUp: ['Pending fixture'] } });
  });
  const label = page.locator(visible('messages')).locator('.delivery-status-shimmer');
  await expect(label).toHaveText('Queued');
  return label;
}

test('status shimmer sweeps left to right without changing text geometry and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const demo = await demoFixture(page);
  try {
    const label = await queuedStatus(page);
    await expect(label).toHaveCSS('animation-name', 'none');
    await expectHeaderTypography(label);
    expect(await label.evaluate(node => getComputedStyle(node).color)).not.toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(label).toHaveCSS('animation-name', 'delivery-status-shimmer');
    await expectHeaderTypography(label);
    const samples = await label.evaluate(node => {
      const animation = node.getAnimations()[0]; animation.pause();
      const sample = (time: number) => {
        animation.currentTime = time;
        const bounds = node.getBoundingClientRect();
        return { position: parseFloat(getComputedStyle(node).backgroundPositionX), width: bounds.width, height: bounds.height, top: bounds.top };
      };
      const first = sample(100), second = sample(1500);
      animation.play();
      return { first, second };
    });
    // A 300%-wide gradient moves from 100% to 0%, sweeping its bright band rightward.
    expect(samples.second.position).toBeLessThan(samples.first.position);
    expect(samples.second.width).toBe(samples.first.width);
    expect(samples.second.height).toBe(samples.first.height);
    expect(samples.second.top).toBe(samples.first.top);
    await expect(label).toHaveText('Queued');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('status shimmer pauses in hidden sessions and resumes on return without replacing the label', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const label = await queuedStatus(page);
    await label.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'same-shimmer'; });
    const panel = await page.locator('.session-view').getAttribute('id');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('new temporary session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#open-sessions .session-row')).toHaveCount(2);
    const hiddenLabel = page.locator(`#${panel} .delivery-status-shimmer`);
    await expect(hiddenLabel).toHaveCSS('animation-play-state', 'paused');
    await page.locator(`#open-sessions .session-row[aria-controls="${panel}"]`).click();
    await expect(hiddenLabel).toHaveCSS('animation-play-state', 'running');
    await expect(hiddenLabel).toHaveAttribute('data-test-identity', 'same-shimmer');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('immediately acknowledged steering shimmers until the authoritative user event, not dequeue', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.evaluate(() => {
      const state = window as unknown as {
        __fixtureChannels: Record<string, { onmessage(packet: unknown): void }>;
        __TAURI_INTERNALS__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
      };
      const channel = Object.values(state.__fixtureChannels)[0];
      const emit = (value: unknown) => channel.onmessage({ kind: 'rpc', value });
      const invoke = state.__TAURI_INTERNALS__.invoke;
      state.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const request = args?.message as { type?: string; id?: string; message?: string };
        if (command === 'write_pi' && request.type === 'prompt') {
          // Both arrive before the first paint: the reported native regression.
          emit({ type: 'response', id: request.id, command: 'prompt', success: true });
          emit({ type: 'queue_update', steering: [request.message], followUp: [] });
          return;
        }
        return invoke(command, args);
      };
      emit({ type: 'agent_start' });
    });
    const prompt = page.locator(visible('prompt'));
    await expect(page.locator(visible('keyboard-hint'))).toContainText('Enter to steer');
    await prompt.fill('Change course'); await prompt.press('Enter');
    const turn = page.locator(visible('messages')).locator('.message.user').filter({ hasText: 'Change course' });
    const label = turn.locator('.delivery-status-shimmer');
    await expect(label).toHaveText('Steering');
    await expectHeaderTypography(label);
    await expect(turn).toHaveClass(/sticky-turn/);
    await label.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'same-steering-label'; });
    await prompt.fill('Newer draft');
    await page.evaluate(() => {
      const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
      channel.onmessage({ kind: 'rpc', value: { type: 'queue_update', steering: [], followUp: [] } });
      channel.onmessage({ kind: 'rpc', value: { type: 'message_end', message: { role: 'assistant', timestamp: 123456, content: 'Continuing work' } } });
    });
    await expect(label).toHaveAttribute('data-test-identity', 'same-steering-label');
    const position = await label.evaluate(node => getComputedStyle(node).backgroundPositionX);
    await expect.poll(() => label.evaluate(node => getComputedStyle(node).backgroundPositionX)).not.toBe(position);
    await turn.evaluate(node => { (node as HTMLElement).dataset.testIdentity = 'same-steering-turn'; });
    await page.evaluate(() => {
      const channel = Object.values((window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels)[0];
      channel.onmessage({ kind: 'rpc', value: { type: 'message_end', message: { role: 'user', timestamp: 123457, content: 'Change course' } } });
    });
    await expect(turn.locator('.delivery-status-shimmer')).toHaveCount(0);
    await expect(turn).toHaveAttribute('data-test-identity', 'same-steering-turn');
    await expect(turn).toHaveCount(1);
    await expect(prompt).toHaveValue('Newer draft'); await expect(prompt).toBeFocused();
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
