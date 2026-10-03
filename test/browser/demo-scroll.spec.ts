import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('offline demo keeps following across repeated turns at fractional zoom', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    for (let turn = 1; turn <= 4; turn++) {
      await demo.turn(turn);
      await expect.poll(async () => (await demo.metrics()).gap, { message: `Turn ${turn} should remain at the transcript bottom` }).toBeLessThanOrEqual(2);
    }
    expect((await demo.metrics()).max).toBeGreaterThan(500);
  } finally { await demo.close(); }
});

test('large drafts and submissions keep following without per-keystroke transcript jitter', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const prompt = page.locator(visible('prompt'));
    const collapsedHeight = await prompt.evaluate(field => field.getBoundingClientRect().height);
    await prompt.fill(Array.from({ length: 60 }, (_, i) => `Long draft line ${i}`).join('\n'));
    await expect.poll(async () => prompt.evaluate(field => field.getBoundingClientRect().height)).toBeGreaterThan(collapsedHeight);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    // Measure synchronously as well as after paint: height:auto used to clamp
    // the transcript during measurement, even with no final height change.
    const movement = await prompt.evaluate(field => {
      const textarea = field as HTMLTextAreaElement;
      const pane = textarea.closest('.session-view')!.querySelector<HTMLElement>('[data-pi-id="transcript-viewport"]')!;
      const before = pane.scrollTop;
      textarea.value += ' another character';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return Math.abs(pane.scrollTop - before);
    });
    expect(movement).toBeLessThanOrEqual(2);
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    await expect.poll(async () => prompt.evaluate(field => field.getBoundingClientRect().height)).toBeLessThanOrEqual(collapsedHeight + 1);
    await page.waitForFunction(() => (window as unknown as { __fixtureSettled: number }).__fixtureSettled >= 3);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('single-line typing keeps composer height stable', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const demo = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt'));
    await expect(prompt).toHaveAttribute('autocorrect', 'off');
    await expect(prompt).toHaveAttribute('autocomplete', 'off');
    await expect(prompt).toHaveAttribute('writingsuggestions', 'false');
    for (const zoom of [1, 1.1, 1.25, 1.5, 2]) {
      await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
      await prompt.fill('');
      const initialHeight = await prompt.evaluate(field => field.getBoundingClientRect().height);
      // Exercise native caret scrolling before returning to a short draft.
      await prompt.fill(Array.from({ length: 30 }, () => 'Long draft').join('\n'));
      await prompt.press('End');
      await prompt.fill('');
      await prompt.focus();
      const measurements = [];
      for (const character of 'Single line: abcdefghijklmnopqrstuvwxyz') {
        await page.keyboard.type(character);
        measurements.push(await prompt.evaluate(field => ({
          text: (field as HTMLTextAreaElement).value,
          height: field.getBoundingClientRect().height,
          scrollHeight: field.scrollHeight,
          scrollTop: field.scrollTop,
        })));
      }
      expect(measurements.filter(value => Math.abs(value.height - initialHeight) > 1), `zoom ${zoom}`).toEqual([]);

      const firstLine = 'Let’s talk about settings ';
      await prompt.fill(`${firstLine}\nWe need somewhere to store settings. I’m thinking \`~/.config/nimrod/\`.`);
      const multilineHeight = await prompt.evaluate(field => field.getBoundingClientRect().height);
      await prompt.evaluate((field, caret) => (field as HTMLTextAreaElement).setSelectionRange(caret, caret), firstLine.length);
      for (const character of 'management') {
        await page.keyboard.type(character);
        expect(await prompt.evaluate(field => field.getBoundingClientRect().height), `typing above another line at zoom ${zoom}`).toBe(multilineHeight);
      }
    }
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('horizontal scrolling in assistant code does not unanchor the next single-line turn', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    const code = page.locator(visible('messages')).locator('pre').last();
    await code.evaluate(node => {
      // Reproduce the small negative Y component emitted by a predominantly
      // horizontal trackpad gesture; native horizontal scrolling alone has Y=0.
      node.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: -1, bubbles: true }));
    });
    await demo.turn(3);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
  } finally { await demo.close(); }
});

test('real upward scrolling pauses follow; returning to the bottom resumes it', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1); await demo.turn(2);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, -180);
    await expect.poll(async () => (await demo.metrics()).gap).toBeGreaterThan(100);
    const reading = (await demo.metrics()).top;
    await demo.turn(3);
    expect(Math.abs((await demo.metrics()).top - reading)).toBeLessThanOrEqual(2);
    await page.locator(visible('transcript-viewport')).hover({ position: { x: 20, y: 30 } });
    await page.mouse.wheel(0, 10000);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
    await demo.turn(4);
    await expect.poll(async () => (await demo.metrics()).gap).toBeLessThanOrEqual(2);
  } finally { await demo.close(); }
});
