import { test, expect } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('recent-project rows show dot/name/muted parent/Enter inline without a folder action', async ({ page }) => {
  const longParent = `/other/${'long-parent-directory-'.repeat(20)}`;
  const f = await demoFixture(page, { 'nimrod.workspaces.v1': ['/work/nimrod', `${longParent}/nimrod`] });
  try {
    await page.locator(visible('prompt')).fill('Untouched draft');
    await page.keyboard.press('Meta+Shift+P');
    await page.locator('#palette-input').fill('Open recent project');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#palette-title')).toHaveText('Open recent project');
    const markers = page.locator('#palette-list .palette-selection-marker');
    await expect(markers).toHaveCount(3);
    expect(await markers.allTextContents()).toEqual(['•', '', '']);
    await expect(page.locator('#palette-list .palette-item-badge, #palette-browse, #palette-project-footer')).toHaveCount(0);
    await expect(page.locator('#palette-list .palette-project-enter')).toHaveCount(3);
    const rows = page.locator('#palette-list .palette-project-row');
    const geometry = () => rows.evaluateAll(nodes => nodes.map(row => {
      const marker = row.querySelector('.palette-selection-marker')!;
      const label = row.querySelector('.palette-item-label')!;
      const parent = row.querySelector('.palette-project-parent')!;
      const enter = row.querySelector('.palette-project-enter')!;
      const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, mid: r.top + r.height / 2 }; };
      return { row: rect(row), marker: rect(marker), label: rect(label), parent: rect(parent), enter: rect(enter), muted: getComputedStyle(parent).color,
        description: getComputedStyle(document.querySelector('#palette-status')!).color, overflow: row.scrollWidth > row.clientWidth + 1,
        parentTruncated: parent.scrollWidth > parent.clientWidth };
    }));
    for (const width of [1100, 560]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await geometry();
      for (const row of layout) {
        expect(row.marker.right).toBeLessThanOrEqual(row.label.left);
        expect(row.label.right).toBeLessThanOrEqual(row.parent.left);
        expect(row.parent.right).toBeLessThanOrEqual(row.enter.left);
        expect(Math.abs(row.label.mid - row.parent.mid)).toBeLessThan(2);
        expect(Math.abs(row.label.mid - row.enter.mid)).toBeLessThan(2);
        expect(row.row.right - row.enter.right).toBeLessThan(16);
        expect(row.muted).toBe(row.description);
        expect(row.overflow, JSON.stringify(row)).toBe(false);
      }
      expect(layout[2].parentTruncated).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+O');
    await expect(page.locator('#palette-title')).toHaveText('Open recent project');
    await page.locator('#palette-input').fill('/other');
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(1);
    await expect(page.locator('#palette-list small')).toHaveText(longParent);
    await page.locator('#palette-input').fill('no match');
    await expect(page.locator('#palette-list [role=option]')).toHaveCount(0);
    await expect(page.locator('#palette-browse')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    await expect(page.locator(visible('prompt'))).toHaveValue('Untouched draft');
    await page.keyboard.press('Meta+Shift+O');
    await page.locator('#palette-input').fill('/work/nimrod');
    await page.locator('#palette-input').press('Enter');
    await expect(page.locator('#command-palette')).not.toBeVisible();
    expect(f.calls.filter(c => c.command === 'open_project_directory')).toHaveLength(1);
    expect(f.calls.filter(c => c.command === 'plugin:dialog|open')).toHaveLength(0);
    expect(f.calls.filter(c => c.command === 'start_pi')).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
