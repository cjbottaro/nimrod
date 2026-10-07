import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

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
    // without changing modal focus or starting any deletion worker.
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
    await page.locator('#deletion-confirm').click();
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
