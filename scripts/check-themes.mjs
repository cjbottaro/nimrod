// Real Chromium color/layout check; no native app, Pi, model, or network content.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
if (!process.env.CHROMIUM) throw new Error('Set CHROMIUM to a local chrome-headless-shell executable');
const dir = mkdtempSync(join(tmpdir(), 'nimrod-theme-check-'));
try {
  const css = readFileSync('src/pi/transcript.css', 'utf8') + readFileSync('src/theme.css', 'utf8');
  const transcript = readFileSync('src/pi/transcript.html', 'utf8');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '<script src="fixture.js"></script>')
    .replace('</head>', '<style id="theme-css"></style></head>');
  const bundle = buildSync({ stdin: { contents: "export {installThemes} from './src/themes/picker'; export {createSafeMarkdownRenderer} from './src/pi/safe-markdown';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Fixture', write: false }).outputFiles[0].text;
  const script = `
(async () => {
  const result = document.createElement('pre'); result.id = 'theme-result'; document.body.append(result);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    const css = ${JSON.stringify(css)};
    document.getElementById('theme-css').textContent = css;
    document.getElementById('welcome').hidden = true;
    document.getElementById('disconnect').hidden = false;
    document.getElementById('mode-badge').textContent = 'Fixture · no model';
    const conversation = document.getElementById('conversation'); conversation.hidden = false;
    conversation.innerHTML = ${JSON.stringify(transcript)};
    document.getElementById('activity').hidden = false;
    const markdown = Fixture.createSafeMarkdownRenderer(window);
    document.getElementById('messages').innerHTML = '<details class="tool-card" open><summary><span class="tool-card-spinner"></span>Fixture tool</summary><div class="tool-output">Output</div></details>' + markdown.render('\u0060\u0060\u0060javascript\\nconst answer = "hello";\\n\u0060\u0060\u0060') + '<article class="message">Fixture history text</article>'.repeat(80);
    const root = document.documentElement, select = document.getElementById('theme-picker');
    let nextId = 0;
    const picker = Fixture.installThemes({ root, select, file: document.getElementById('theme-file'), notice: document.getElementById('theme-notice'), noticeText: document.getElementById('theme-notice-text'), dismiss: document.getElementById('theme-notice-dismiss') }, { read: () => null, save: () => {}, newId: () => 'import-browser-' + (++nextId) });
    const choose = id => { select.value = id; select.dispatchEvent(new Event('change')); };
    const prompt = document.getElementById('prompt'), pane = document.getElementById('transcript-viewport');
    const details = document.querySelector('.tool-card'), spinner = document.querySelector('.tool-card-spinner');
    const rows = [];
    for (const os of ['dark', 'light']) {
      // Exercise both CSS cascade branches deterministically, without changing OS appearance.
      document.getElementById('theme-css').textContent = css.replace('@media (prefers-color-scheme:light)', os === 'light' ? '@media all' : '@media not all');
      choose('nimrod');
      const baseline = getComputedStyle(root).backgroundColor;
      assert(baseline === (os === 'dark' ? 'rgb(21, 28, 32)' : 'rgb(247, 249, 248)'), 'Nimrod system palette');
      prompt.value = 'keep my draft'; prompt.focus(); pane.scrollTop = 120;
      const width = conversation.getBoundingClientRect().width;
      assert(document.getElementById('workspace-bar').scrollWidth <= root.clientWidth, 'Workspace controls fit the window');
      choose('dracula');
      assert(getComputedStyle(root).backgroundColor === 'rgb(40, 42, 54)', 'Dracula background on ' + os);
      assert(getComputedStyle(document.querySelector('.hljs-keyword')).color === 'rgb(255, 121, 198)', 'Dracula keyword color');
      assert(getComputedStyle(document.getElementById('send')).backgroundColor === 'rgb(68, 71, 90)', 'Dracula button');
      assert(getComputedStyle(root).colorScheme === 'dark', 'Dracula stays dark');
      rows.push(os + ': Dracula colors pass');
      await picker.importFile(new File([JSON.stringify({name:'Paper',type:'light',colors:{'editor.background':'#fdfdfd','editor.foreground':'#222222'},tokenColors:[{scope:'keyword',settings:{foreground:'#0055cc'}}]})], 'paper.json'));
      assert(getComputedStyle(root).backgroundColor === 'rgb(253, 253, 253)', 'Imported light background');
      assert(getComputedStyle(document.querySelector('.hljs-keyword')).color === 'rgb(0, 85, 204)', 'Imported syntax color');
      assert(getComputedStyle(root).colorScheme === 'light', 'Imported light controls');
      choose('nimrod');
      assert(getComputedStyle(root).backgroundColor === baseline, 'Nimrod restores without stale overrides');
      assert(conversation.getBoundingClientRect().width === width, 'No theme width change');
      assert(document.querySelector('.tool-card') === details && details.open && spinner.isConnected, 'Disclosure/spinner retained');
      assert(document.activeElement === prompt && prompt.value === 'keep my draft' && pane.scrollTop === 120, 'Focus/draft/scroll retained');
      rows.push(os + ': import, restoration and state pass');
    }
    picker.dispose();
    result.textContent = 'PASS ' + rows.join('; ');
  } catch(error) { result.textContent = 'FAIL ' + error.stack; }
})();`;
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, 'fixture.js'), bundle + script);
  const output = spawnSync(process.env.CHROMIUM, ['--headless', `--window-size=${Number(process.env.VIEWPORT_WIDTH) || 1000},900`, '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${join(dir, 'profile')}`, '--virtual-time-budget=2000', '--dump-dom', pathToFileURL(join(dir, 'index.html')).href], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4_000_000 });
  const result = output.stdout?.match(/<pre id="theme-result">([\s\S]*?)<\/pre>/)?.[1];
  if (output.status !== 0 || !result?.startsWith('PASS ')) throw new Error(result || output.error?.message || output.stderr);
  console.log(result);
} finally { rmSync(dir, { recursive: true, force: true }); }
