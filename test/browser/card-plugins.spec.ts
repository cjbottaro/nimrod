import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('incompatible and missing packages show Settings errors without blocking ordinary offline rendering', async ({ page }) => {
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["bad.json","missing.json"]}',
    packages: { 'bad.json': '{"apiVersion":99}' } });
  try {
    await demo.turn(1);
    await expect(page.locator(visible('messages')).locator('.tool-card-title', { hasText: 'bash' })).toHaveCount(1);
    await page.locator('#open-settings').click();
    await expect(page.locator('#application-notices')).toBeVisible();
    await expect(page.locator('#card-plugin-error')).toBeHidden();
    await expect(page.locator('#application-notices')).toContainText('Unsupported card plugin API version');
    await expect(page.locator('#application-notices')).toContainText('missing.json');
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('local declarative plugin renders offline tool data and settings changes preserve inspected cards', async ({ page }) => {
  const packages = { 'bash.json': JSON.stringify({ apiVersion: 1, id: 'example.bash', tools: ['bash'], preview: 'Custom: {{/arguments/command}}',
    sections: [{ key: 'command', label: 'Requested command', template: '{{/arguments/command}}' }] }) };
  const demo = await demoFixture(page, {}, [], undefined, { settings: '{"cards.plugins":["bash.json"]}', packages });
  try {
    await demo.turn(1);
    const card = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) }).first();
    await expect(card.locator('.tool-card-preview')).toContainText('Custom:');
    await card.locator('summary').first().click();
    await expect(card.locator('[data-output-kind="plugin:command"]')).toContainText('demo: stream fixture output');
    await expect(card.locator('[data-output-kind="result"]')).toContainText('Fixture complete');
    await card.evaluate(node => { node.setAttribute('data-fixture-identity', 'retained'); });
    await demo.editPreferences('{"cards.plugins":[],"cards.renderers":{"bash":"nimrod.raw"}}');
    await demo.turn(2);
    await expect(card).toHaveAttribute('data-fixture-identity', 'retained');
    await expect(card.locator('.tool-card-preview')).toContainText('Custom:');
    const tools = page.locator(visible('messages')).locator('.tool-card').filter({ has: page.locator('.tool-card-title', { hasText: 'bash' }) });
    await expect(tools).toHaveCount(2);
    await expect(tools.nth(1).locator('[data-output-kind="plugin:command"]')).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
