import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { demoFixture, visible } from './demo-fixture';

type FixtureWindow = Window & { __popoutTitle?: string; __copiedText?: string; __trimWrites?: unknown[] };

// Real WebKit layout, mocked native boundary. No Pi, user files or external requests.
async function popoutFixture(page: Page, text: string, language: string, response = false, trim?: { first: number; last: number }) {
  const bundle = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', platform: 'browser', write: false,
    loader: { '.css': 'empty' }, plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\.html\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const css = ['src/pi/transcript.css', 'src/theme.css', 'src/workspace.css', 'src/modal.css', 'src/popout.css', 'src/application-notices.css', 'src/window-appearance.css', 'src/utility-button.css'].map(file => readFileSync(file, 'utf8')).join('\n');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '').replace('</head>', `<style>${css}</style></head>`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(({ text, language, response, trim }) => {
    const state = window as FixtureWindow;
    Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'popout-fixture' }, currentWebview: { label: 'popout-fixture' } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
        if (command === 'scoped_preferences_snapshot') return { text: '{}', state: {}, settingsPath: '/fixture/settings.json', statePath: '/fixture/state.json', revision: 1 };
        if (command === 'tint_window_titlebar') return;
        if (command === 'window_appearance_preview_snapshot') return { revision: 0, opacity: null, blur: null };
        if (command === 'window_appearance_capabilities' || command === 'apply_window_appearance') return { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
        if (command === 'code_popout_snapshot') return { session: 'fixture', title: 'Unused source session name', text, language, response, trim };
        if (command === 'set_response_popout_trim') { (state.__trimWrites ??= []).push(args.trim); return; }
        if (command === 'plugin:webview|set_webview_zoom') return;
        if (command === 'plugin:window|set_title') { state.__popoutTitle = String(args.value); return; }
        if (command === 'plugin:clipboard-manager|write_text') { state.__copiedText = String(args.text); return; }
        throw new Error(`Unexpected native operation: ${command}`);
      },
    } });
  }, { text, language, response, trim });
  await page.route('**/*', route => route.request().url() === 'https://nimrod.test/?popout'
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await page.goto('https://nimrod.test/?popout');
  await page.addScriptTag({ content: bundle.outputFiles![0].text });
  await expect(page.locator('.popout-document')).toBeVisible();
  return errors;
}

test('code pop-out starts directly with its language/Copy row and uses a content-derived title', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 360 });
  const errors = await popoutFixture(page, '\nconst reference = 1;\n', 'ts');
  await expect(page.locator('header, .popout-copy-source')).toHaveCount(0);
  await expect(page.locator('.code-language')).toHaveText('ts');
  await expect(page).toHaveTitle('const reference = 1;');
  await expect(page.locator('.code-copy')).toHaveCount(1);
  const bounds = await page.locator('.code-block').boundingBox();
  expect(bounds?.y).toBe(12);
  await page.locator('.code-copy').click();
  expect(await page.evaluate(() => (window as FixtureWindow).__copiedText)).toBe('\nconst reference = 1;\n');
  expect(errors).toEqual([]);
});

test('Markdown Copy stays at the upper-right without a header or obscuring scrolled content', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 360 });
  const text = '# A **useful** reference\n\n' + 'A paragraph that fills the available width and should remain clear of the Copy icon.\n\n'.repeat(30);
  const errors = await popoutFixture(page, text, 'markdown');
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page).toHaveTitle('A useful reference');
  const copy = page.getByRole('button', { name: 'Copy Markdown source', exact: true });
  await expect(copy).toBeVisible();
  const before = await copy.boundingBox();
  expect(before?.y).toBe(12);
  expect(before?.x).toBe(514);
  const paragraph = await page.locator('.popout-document p').first().boundingBox();
  expect(paragraph!.x + paragraph!.width).toBeLessThanOrEqual(before!.x - 12);
  await page.locator('.popout-content').evaluate(node => { node.scrollTop = 400; });
  const after = await copy.boundingBox();
  expect(after).toEqual(before);
  await copy.click();
  expect(await page.evaluate(() => (window as FixtureWindow).__copiedText)).toBe(text);
  expect(await page.evaluate(() => (window as FixtureWindow).__popoutTitle)).toBe('A useful reference');
  expect(errors).toEqual([]);
});

test('response Pop-out reveals the inset action on hover and keyboard focus without moving the response', async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await demo.turn(1);
    const turn = page.locator(visible('messages')).locator('.assistant.has-response-popout').last();
    const button = turn.getByRole('button', { name: 'Pop out response' });
    const prose = turn.locator(':scope > .markdown').first();
    await turn.scrollIntoViewIfNeeded();
    await page.locator(visible('prompt')).hover();
    await expect(button).toHaveCSS('opacity', '0');
    await expect(button).toHaveCSS('position', 'absolute');
    const before = await prose.boundingBox();
    await turn.hover();
    await expect(button).toHaveCSS('opacity', '1');
    expect(await prose.boundingBox()).toEqual(before);
    const [turnBounds, buttonBounds] = await Promise.all([turn.boundingBox(), button.boundingBox()]);
    expect(buttonBounds!.x).toBeGreaterThanOrEqual(before!.x + before!.width);
    expect(buttonBounds!.x + buttonBounds!.width).toBeLessThan(turnBounds!.x + turnBounds!.width);
    await page.locator(visible('prompt')).hover();
    await button.focus();
    await expect(button).toHaveCSS('opacity', '1');
    await button.press('Enter');
    await expect.poll(() => demo.calls.filter(call => call.command === 'open_code_popout').length).toBe(1);
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});

test('response toolbar shows the slider next to Copy and can restore a contiguous Markdown range', async ({ page }) => {
  const text = '# Complete response\n\nA middle paragraph.\n\n```ts\nconst value = 1;\n```\n\nLast paragraph.';
  const errors = await popoutFixture(page, text, 'markdown', true, { first: 1, last: 2 });
  const document = page.locator('.popout-document');
  await expect(page).toHaveTitle('Complete response');
  await expect(document).toContainText('A middle paragraph.');
  await expect(document).not.toContainText('Last paragraph.');
  await expect(document.locator('.code-popout')).toHaveCount(0);
  const toolbar = page.locator('.popout-response-toolbar');
  const first = toolbar.getByRole('slider', { name: 'First block to keep' });
  const last = toolbar.getByRole('slider', { name: 'Last block to keep' });
  const copy = toolbar.getByRole('button', { name: 'Copy Markdown source', exact: true });
  await expect(toolbar.getByRole('button')).toHaveCount(1);
  await expect(copy).toBeVisible();
  const [sliderBounds, copyBounds] = await Promise.all([first.boundingBox(), copy.boundingBox()]);
  expect(sliderBounds!.x + sliderBounds!.width).toBeLessThan(copyBounds!.x);
  expect(copyBounds!.y + copyBounds!.height / 2).toBeCloseTo(sliderBounds!.y + sliderBounds!.height / 2);
  await expect(first).toHaveValue('1');
  await first.press('ArrowRight');
  await expect(document).not.toContainText('A middle paragraph.');
  await expect(last).toHaveValue('2');
  await first.press('ArrowRight');
  await expect(first).toHaveValue('2');
  await copy.click();
  expect(await page.evaluate(() => (window as FixtureWindow).__copiedText)).toMatch(/^```ts\nconst value = 1;\n```\n*$/);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).__trimWrites)).toEqual([{ first: 2, last: 2 }]);
  await first.press('ArrowLeft');
  await first.press('ArrowLeft');
  await last.press('ArrowRight');
  await expect(document).toContainText('Complete response');
  await expect(document).toContainText('Last paragraph.');
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).__trimWrites?.at(-1))).toBeNull();
  expect(errors).toEqual([]);
});
