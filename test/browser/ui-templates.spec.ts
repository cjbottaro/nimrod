import { test, expect } from '@playwright/test';
import path from 'node:path';
import { demoFixture, visible } from './demo-fixture';

test('custom templates put the sidebar on the right, preserve owned drafts and resize in the correct direction', async ({ page }) => {
  const f = await demoFixture(page, {}, [], undefined, undefined, { uiTemplates: {
    layout: '<div class="custom-layout"><nimrod-slot name="project-bar"></nimrod-slot><div data-nimrod-sidebar-layout data-nimrod-sidebar-side="right"><nimrod-slot name="content"></nimrod-slot><nimrod-slot name="sidebar-resizer"></nimrod-slot><nimrod-slot name="session-sidebar"></nimrod-slot></div></div>',
    layoutCss: '.custom-layout { display:grid; height:100%; min-height:0; grid-template-rows:48px minmax(0,1fr); }',
    projectBar: '<nav class="custom-bar"><button data-nimrod-action="sidebar">Sessions</button><b data-nimrod-text="project.name"></b><span data-nimrod-text="session.title" data-nimrod-visible="session.present"></span><button data-nimrod-action="settings">Preferences</button></nav>',
    projectBarCss: '.custom-bar { display:flex; align-items:center; gap:8px; }',
  } });
  try {
    await expect(page.locator('.custom-bar b')).toHaveText(path.basename(process.cwd()));
    await page.locator('#sidebar-new').click();
    const prompt = page.locator(visible('prompt'));
    await prompt.fill('Unsent custom-layout draft');
    await page.evaluate(() => { (window as unknown as { retainedPrompt: Element | null }).retainedPrompt = document.querySelector('.session-view:not([hidden]) [data-pi-id="prompt"]'); });
    const geometry = await page.evaluate(() => ({
      sidebar: document.querySelector('#session-sidebar')!.getBoundingClientRect().left,
      content: document.querySelector('#workspace-content')!.getBoundingClientRect().right,
    }));
    expect(geometry.sidebar).toBeGreaterThanOrEqual(geometry.content - 1);
    const sidebar = page.locator('#session-sidebar'), before = await sidebar.evaluate(node => node.getBoundingClientRect().width);
    await page.locator('#sidebar-resizer').focus();
    await page.keyboard.press('ArrowLeft');
    expect(await sidebar.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(before);
    await expect(prompt).toHaveValue('Unsent custom-layout draft');
    expect(await page.evaluate(() => (window as unknown as { retainedPrompt: Element | null }).retainedPrompt === document.querySelector('.session-view:not([hidden]) [data-pi-id="prompt"]'))).toBe(true);
    await page.locator('#open-settings').click();
    await expect(page.locator('#settings-page')).toBeVisible();
    await page.locator('#settings-back').click();
    await expect(prompt).toHaveValue('Unsent custom-layout draft');
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
