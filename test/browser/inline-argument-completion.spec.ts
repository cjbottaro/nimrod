import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

const longName = `skill-${'wrapped'.repeat(40)}`;
test('inline argument hints and completions stay outside the draft and track wrapped composer typography', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    const token = String(demo.calls.find(call => call.command === 'start_copilot')!.args.token);
    // Synthetic catalog update only. No harness invocation or provider work.
    await page.evaluate(({ token, longName }) => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      channels[token].onmessage({ kind: 'rpc', value: { kind: 'commands', commands: [
        { name: 'review-pr', kind: 'skill', input: { hint: 'instructions for the skill' } },
        { name: longName, kind: 'skill', input: { hint: 'optional details' } },
        { name: 'permissions', kind: 'builtin', input: { hint: '[default|allow-all|allow-tools]', choices: [
          { name: 'default', description: 'Ask first' }, { name: 'allow-all', description: 'Allow all' },
          { name: 'allow-tools', description: 'Allow tools' },
        ] } },
      ] } });
    }, { token, longName });
    const prompt = page.locator(visible('prompt'));
    const shell = page.locator(visible('composer-shell'));
    const overlay = shell.locator('.composer-inline-completion');
    const suffix = shell.locator('.composer-inline-suffix');
    await prompt.fill('/review-pr');
    await expect(overlay).toBeVisible(); await expect(suffix).toHaveText(' [instructions for the skill]');
    await expect(page.locator(visible('slash-suggestions'))).toBeHidden();
    await expect(prompt).toHaveValue('/review-pr');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(await overlay.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');
    await prompt.fill('/permissions al'); await expect(suffix).toHaveText('low-all');
    await prompt.press('ArrowDown'); await expect(suffix).toHaveText('low-tools');
    await prompt.press('Tab'); await expect(prompt).toHaveValue('/permissions allow-tools ');
    await expect(overlay).toBeHidden();
    await prompt.fill('/permissions al'); await prompt.press('Escape'); await expect(overlay).toBeHidden();
    await expect(prompt).toHaveValue('/permissions al');

    // Proportional font, wrapping and an overflowing textarea share geometry.
    await shell.evaluate(node => {
      node.style.width = '260px';
      node.style.setProperty('--nimrod-conversation-font', 'Arial');
      node.style.setProperty('--nimrod-conversation-size', '18px');
    });
    await prompt.fill(`/${longName}`); await expect(overlay).toBeVisible();
    await expect.poll(() => prompt.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await prompt.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => shell.evaluate(node => {
      const input = node.querySelector('textarea')!;
      const mirror = node.querySelector<HTMLElement>('.composer-inline-mirror')!;
      return mirror.style.transform === `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    })).toBe(true);
    const geometry = await shell.evaluate(node => {
      const input = node.querySelector('textarea')!;
      const mirror = node.querySelector<HTMLElement>('.composer-inline-mirror')!;
      const prefix = node.querySelector('.composer-inline-prefix')!.firstChild!;
      const range = document.createRange();
      range.setStart(prefix, prefix.textContent!.length - 1); range.setEnd(prefix, prefix.textContent!.length);
      const last = range.getBoundingClientRect();
      const suffix = node.querySelector('.composer-inline-suffix')!.getBoundingClientRect();
      return { font: getComputedStyle(input).font, mirrorFont: getComputedStyle(mirror).font,
        dx: suffix.left - last.right, dy: suffix.top - last.top, height: input.clientHeight };
    });
    expect(geometry.font).toBe(geometry.mirrorFont);
    expect(Math.abs(geometry.dx)).toBeLessThan(2);
    expect(Math.abs(geometry.dy)).toBeLessThan(2);
    expect(geometry.height).toBeLessThanOrEqual(160);
    await expect(prompt).toHaveValue(`/${longName}`);
    expect(demo.calls.some(call => call.command === 'write_copilot' &&
      ['prompt', 'command'].includes((call.args.message as { method?: string }).method ?? ''))).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('autocomplete acceptance defaults to Tab and updates live in an existing mounted session', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('New Copilot session');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator(visible('send'))).toBeEnabled();
    const prompt = page.locator(visible('prompt'));
    const commandCalls = () => demo.calls.filter(call => call.command === 'write_copilot' &&
      (call.args.message as { method?: string }).method === 'command');
    // This is the isolated SDK fixture's provider-free report, not a real session.
    await prompt.fill('/permissions sh'); await prompt.press('Enter');
    await expect(page.locator(visible('messages'))).toContainText('Fixture permission report: sh');
    expect((commandCalls()[0].args.message as { input: string }).input).toBe('sh');
    await expect(prompt).toHaveValue('');
    await prompt.fill('/permissions sh');
    await demo.editPreferences('{"interaction.autocompleteAccept":"tabOrEnter"}');
    await expect(prompt).toHaveValue('/permissions sh');
    await prompt.press('Enter'); await expect(prompt).toHaveValue('/permissions show ');
    expect(commandCalls()).toHaveLength(1, 'Enter completion is not command invocation');
    await demo.editPreferences('{}');
    await expect(prompt).toHaveValue('/permissions show ');
    expect(demo.calls.some(call => call.command === 'write_copilot' &&
      (call.args.message as { method?: string }).method === 'prompt')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
