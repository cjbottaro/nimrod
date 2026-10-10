import { test, expect } from '@playwright/test';
import path from 'node:path';
import { demoFixture } from './demo-fixture';

test('project identity preserves its name while the parent truncates, including narrow windows', async ({ page }) => {
  const f = await demoFixture(page);
  try {
    await expect(page.locator('#project-name')).toHaveText(path.basename(process.cwd()));
    await expect(page.locator('#project-identity')).toHaveAttribute('title', process.cwd());
    await expect(page.locator('#workspace-bar .wordmark, #workspace-bar .spark')).toHaveCount(0);
    // Exercise a typical short project name with a deliberately long parent,
    // independent of the task worktree's unusually long directory name.
    await page.evaluate(() => {
      document.querySelector('#project-name')!.textContent = 'nimrod';
      document.querySelector('#workspace-label')!.textContent = `~/Projects/${'long-parent/'.repeat(30)}`;
    });
    for (const width of [1100, 560, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.locator('#project-name')).toBeVisible();
      const layout = await page.locator('#project-identity').evaluate(identity => {
        const name = identity.querySelector<HTMLElement>('#project-name')!;
        const parent = identity.querySelector<HTMLElement>('#workspace-label')!;
        const bar = document.querySelector<HTMLElement>('#workspace-bar')!;
        return {
          nameTruncated: name.scrollWidth > name.clientWidth,
          parentTruncated: parent.scrollWidth > parent.clientWidth,
          barOverflow: bar.scrollWidth > bar.clientWidth + 1,
          nameRight: name.getBoundingClientRect().right,
          identityRight: identity.getBoundingClientRect().right,
          centerDelta: Math.abs((name.getBoundingClientRect().top + name.getBoundingClientRect().height / 2)
            - (parent.getBoundingClientRect().top + parent.getBoundingClientRect().height / 2)),
        };
      });
      expect(layout.centerDelta).toBeLessThan(1);
      expect(layout.nameTruncated).toBe(false);
      expect(layout.barOverflow).toBe(false);
      expect(layout.nameRight).toBeLessThanOrEqual(layout.identityRight + 1);
      if (width === 360) expect(layout.parentTruncated).toBe(true);
    }
    await page.locator('#project-name').evaluate(name => { name.textContent = 'exceptionally-long-project-name-'.repeat(20); });
    const longName = await page.locator('#project-identity').evaluate(identity => {
      const name = identity.querySelector<HTMLElement>('#project-name')!;
      const parent = identity.querySelector<HTMLElement>('#workspace-label')!;
      return { truncated: name.scrollWidth > name.clientWidth, parentWidth: parent.clientWidth };
    });
    expect(longName.truncated).toBe(true);
    expect(longName.parentWidth).toBe(0);
    // The clipped inter-label gap may extend the flex scroll width by 8px;
    // it must not cause horizontal overflow of the Project bar itself.
    expect(await page.locator('#workspace-bar').evaluate(bar => bar.scrollWidth > bar.clientWidth + 1)).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
