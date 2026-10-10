import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

test('deletion review preserves the idle sidebar indicator; only confirmed shutdown/removal shows Deleting', async ({ page }) => {
  const file = '/fixture/saved.jsonl', project = process.cwd();
  const demo = await demoFixture(page, {
    [`nimrod.tabs.v1:${project}`]: { tabs: [{ path: file, sessionId: 'saved', name: 'Saved fixture', lastUsed: 100 }] },
    // Keep restored history unpresented until New temporary session: never launch Pi.
    [`nimrod.sidebar.view:${project}`]: 'working',
  });
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep the offline draft');
    const row = page.locator('.open-session').filter({ hasText: 'Saved fixture' });
    const indicator = row.locator('.session-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'inactive');
    const phase = (id: string, value: 'lock' | 'check' | 'review' | 'quarantine' | 'release') => ({
      id, phase: value, files: [file], results: [], pending: value !== 'release',
      ...(value === 'review' ? { tree: [{ file, title: 'Saved fixture' }] } : {}),
    });
    for (const id of ['cancel', 'confirm']) {
      await demo.deletionEvent(phase(`${id}-lock`, 'lock'));
      await expect.poll(() => demo.calls.filter(call => call.command === 'acknowledge_deletion').length).toBe(id === 'cancel' ? 1 : 2);
      await demo.deletionEvent(phase(id, 'review'));
      await expect(page.locator('#deletion-review')).toBeVisible();
      await expect(indicator).toHaveAttribute('data-state', 'inactive');
      expect(await indicator.evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
      await expect(row.locator('.session-row')).toHaveAttribute('aria-label', 'Saved fixture — Inactive');
      await expect(page.locator('#sidebar-working-count')).toHaveText('0');
      await page.keyboard.press(id === 'cancel' ? 'Escape' : 'Enter');
      await expect(page.locator('#deletion-review')).not.toBeVisible();
      if (id === 'cancel') {
        await demo.deletionEvent(phase(id, 'release'));
        await expect(indicator).toHaveAttribute('data-state', 'inactive');
      }
    }
    await demo.deletionEvent(phase('check', 'check'));
    await demo.deletionEvent(phase('execute', 'quarantine'));
    await expect(indicator).toHaveAttribute('data-state', 'deleting');
    await expect(row.locator('.session-row')).toHaveAttribute('aria-label', 'Saved fixture — Deleting');
    expect(await indicator.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('sidebar-indicator-spin');
    await expect(page.locator('#sidebar-working-count')).toHaveText('0');
    await demo.deletionEvent({ id: 'complete', phase: 'complete', files: [file], results: [{ file, deleted: true }], pending: false });
    await expect(row).toHaveCount(0); await expect(prompt).toHaveValue('Keep the offline draft');
    expect(demo.children.size).toBe(1); expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('deletion tree has compact even rows, aligned session icons, guide lines and wrapped secondary details', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const tree = [
      { file: '/fixture/root', title: 'Root' },
      { file: '/fixture/child', title: 'Child', parent: '/fixture/root' },
      { file: '/fixture/grandchild', title: 'Grandchild', parent: '/fixture/child' },
      { file: '/fixture/sibling', title: 'Sibling', parent: '/fixture/root' },
    ];
    const review = (id: string, sessions = tree) => ({ id, phase: 'review' as const, files: sessions.map(s => s.file), tree: sessions, results: [], pending: true });
    await demo.deletionEvent(review('spacing'));
    const rows = page.locator('.deletion-tree-row');
    await expect(rows).toHaveCount(4);
    await expect(page.locator('.deletion-tree-icon[aria-hidden="true"][focusable="false"]')).toHaveCount(4);
    await expect(page.locator('#deletion-cancel')).toBeFocused();
    const bounds = await rows.evaluateAll(nodes => nodes.map(node => {
      const row = node.getBoundingClientRect(), name = node.querySelector('.deletion-tree-name')!.getBoundingClientRect();
      const icon = node.querySelector('svg')!.getBoundingClientRect();
      return { top: row.top, bottom: row.bottom, height: row.height, nameLeft: name.left, iconLeft: icon.left, iconWidth: icon.width };
    }));
    const zoom = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
    for (let i = 0; i < bounds.length; i++) {
      expect(bounds[i].height).toBeCloseTo(32 * zoom, 0);
      expect(bounds[i].iconWidth).toBe(16 * zoom);
      expect(bounds[i].nameLeft - bounds[i].iconLeft).toBe(24 * zoom);
      if (i) expect(bounds[i].top - bounds[i - 1].bottom).toBeCloseTo(0, 0);
    }
    expect(bounds[1].nameLeft - bounds[0].nameLeft).toBe(24 * zoom);
    expect(bounds[2].nameLeft - bounds[1].nameLeft).toBe(24 * zoom);
    expect(bounds[3].nameLeft).toBe(bounds[1].nameLeft);
    const guides = await page.locator('#deletion-tree ul ul > li').first().evaluate(node => ({
      vertical: getComputedStyle(node, '::before').borderLeftWidth,
      horizontal: getComputedStyle(node, '::after').borderTopWidth,
    }));
    expect(guides).toEqual({ vertical: '1px', horizontal: '1px' });
    await page.keyboard.press('Escape');
    await demo.deletionEvent({ id: '', phase: 'release', files: [], results: [], pending: false });
    await page.setViewportSize({ width: 420, height: 700 });
    const longTitle = 'A long session name that should wrap instead of shifting its icon or overflowing the confirmation dialog';
    const details = tree.map((session, i) => ({ ...session, title: longTitle, file: `${session.file}${'x'.repeat(100)}`, parent: session.parent ? `${session.parent}${'x'.repeat(100)}` : undefined, cwd: i ? '/projects/another-project' : '/projects/original-project' }));
    await demo.deletionEvent(review('details', details));
    await expect(page.locator('#deletion-tree small')).toHaveCount(8);
    const alignment = await page.locator('.deletion-tree-text').evaluateAll(nodes => nodes.map(node => {
      const name = node.querySelector('.deletion-tree-name')!.getBoundingClientRect();
      return [...node.querySelectorAll('small')].every(detail => Math.abs(detail.getBoundingClientRect().left - name.left) < 1);
    }));
    expect(alignment.every(Boolean)).toBe(true);
    expect(await page.locator('#deletion-tree').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(page.locator('#deletion-confirm')).toBeVisible();
    await expect(page.locator('#deletion-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    expect(demo.calls.some(call => call.command === 'delete_session_tree')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('session-tree confirmation is scrollable app UI with safe default focus, cancellation and one correlated answer', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    const prompt = page.locator(visible('prompt')); await prompt.fill('Keep this draft');
    const tree = [{ file: '/fixture/root', title: 'Root' }, ...Array.from({ length: 100 }, (_, i) => ({ file: `/fixture/child-${i}`, title: `Child ${i}`, parent: '/fixture/root' }))];
    const review = (id: string) => ({ id, phase: 'review' as const, files: tree.map(s => s.file), tree, results: [], pending: true });
    await demo.deletionEvent(review('cancel-review'));
    const dialog = page.getByRole('dialog', { name: 'Delete session tree', exact: true });
    await expect(dialog).toBeVisible();
    const modalStyle = (node: Element) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color, border: style.borderTop, radius: style.borderRadius, padding: style.padding, shadow: style.boxShadow, font: style.fontFamily, top: style.top, backdrop: getComputedStyle(node, '::backdrop').backgroundColor };
    };
    expect(await dialog.evaluate(modalStyle)).toEqual(await page.locator('#command-palette').evaluate(modalStyle));
    await expect(page.locator('#deletion-title')).toHaveCSS('font-size', await page.locator('#palette-title').evaluate(node => getComputedStyle(node).fontSize));
    await expect(page.locator('#deletion-cancel')).toBeFocused();
    await expect(page.locator('#deletion-tree li')).toHaveCount(101);
    await expect(page.locator('#deletion-confirm')).toHaveText('Delete 101 sessions');
    expect(await page.locator('#deletion-tree').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await page.locator('#deletion-tree').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(page.locator('#deletion-confirm')).toBeVisible();
    const bounds = (await dialog.boundingBox())!, button = (await page.locator('#deletion-confirm').boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    // Imported dark and system-light themes must use the same surface tokens,
    // without changing modal focus or performing native file deletion.
    await demo.editPreferences('{"appearance.theme":"dracula"}');
    expect(await dialog.evaluate(modalStyle)).toEqual(await page.locator('#command-palette').evaluate(modalStyle));
    await expect(page.locator('#deletion-cancel')).toBeFocused();
    await page.emulateMedia({ colorScheme: 'light' }); await demo.editPreferences('{}');
    expect(await dialog.evaluate(modalStyle)).toEqual(await page.locator('#command-palette').evaluate(modalStyle));
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible(); await expect(prompt).toBeFocused();
    await expect.poll(() => demo.calls.filter(c => c.command === 'confirm_session_deletion')).toHaveLength(1);
    expect(demo.calls.find(c => c.command === 'confirm_session_deletion')?.args).toMatchObject({ id: 'cancel-review', confirmed: false });
    await demo.deletionEvent({ id: '', phase: 'release', files: [], results: [], pending: false });
    await demo.deletionEvent(review('accept-review'));
    await expect(page.locator('#deletion-cancel')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => demo.calls.filter(c => c.command === 'confirm_session_deletion')).toHaveLength(2);
    expect(demo.calls.filter(c => c.command === 'confirm_session_deletion')[1].args).toMatchObject({ id: 'accept-review', confirmed: true });
    await demo.deletionEvent({ id: '', phase: 'release', files: [], results: [], pending: false });
    await expect(prompt).toHaveValue('Keep this draft');
    expect(demo.children.size).toBe(1);
    expect(demo.calls.some(c => c.command === 'delete_session_tree')).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
