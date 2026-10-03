import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type FixtureWindow = Window & { __popoutTitle?: string; __copiedText?: string };

// Real WebKit layout, mocked native boundary. No Pi, user files or external requests.
async function popoutFixture(page: Page, text: string, language: string) {
  const bundle = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', platform: 'browser', write: false,
    loader: { '.css': 'empty' }, plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\.html\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const css = ['src/pi/transcript.css', 'src/theme.css', 'src/workspace.css', 'src/popout.css'].map(file => readFileSync(file, 'utf8')).join('\n');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '').replace('</head>', `<style>${css}</style></head>`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(({ text, language }) => {
    const state = window as FixtureWindow;
    Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'popout-fixture' }, currentWebview: { label: 'popout-fixture' } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
        if (command === 'preferences_snapshot') return { text: '{}', state: {}, settingsPath: '/fixture/settings.json', statePath: '/fixture/state.json', revision: 1 };
        if (command === 'code_popout_snapshot') return { session: 'fixture', title: 'Unused source session name', text, language };
        if (command === 'plugin:webview|set_webview_zoom') return;
        if (command === 'plugin:window|set_title') { state.__popoutTitle = String(args.value); return; }
        if (command === 'plugin:clipboard-manager|write_text') { state.__copiedText = String(args.text); return; }
        throw new Error(`Unexpected native operation: ${command}`);
      },
    } });
  }, { text, language });
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
