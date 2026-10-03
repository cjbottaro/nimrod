// Optional real-layout check, using an explicitly supplied local Chromium executable.
// No app/Pi launch, model request, or network content. This is not native WebKit acceptance.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const browser = process.env.CHROMIUM;
if (!browser) throw new Error('Set CHROMIUM to a local Chromium executable');
const dir = mkdtempSync(join(tmpdir(), 'nimrod-layout-'));
try {
  const css = readFileSync('src/pi/transcript.css', 'utf8') + readFileSync('src/theme.css', 'utf8');
  const transcript = readFileSync('src/pi/transcript.html', 'utf8');
  const inner = `<!doctype html><html><head><style>${css}</style></head><body><header id="workspace-bar">Nimrod</header><div id="conversation">${transcript}</div></body></html>`;
  const file = join(dir, 'layout.html');
  writeFileSync(file, `<!doctype html><body><iframe id="frame" style="height:800px;border:0"></iframe><pre id="layout-result"></pre><script>
    const frame = document.getElementById('frame');
    const doc = frame.contentDocument;
    doc.open(); doc.write(${JSON.stringify(inner).replaceAll('<', '\\u003c')}); doc.close();
    doc.getElementById('activity').hidden = false;
    doc.getElementById('submission-notice').hidden = false;
    doc.getElementById('messages').innerHTML = '<article class="message">A wrapping conversation paragraph with ordinary text.</article>'.repeat(100);
    const rows = [];
    try {
      for (const width of [560, 960, 2560, 5120, 960, 560]) {
        frame.style.width = width + 'px';
        const view = frame.contentWindow;
        for (const id of ['app', 'activity', 'submission-notice', 'composer']) {
          const node = doc.getElementById(id), style = view.getComputedStyle(node);
          const actual = node.getBoundingClientRect().width, expected = node.parentElement.clientWidth;
          if (Math.abs(actual - expected) > 1 || style.paddingLeft !== '20px' || style.paddingRight !== '20px') {
            throw new Error(id + ' at ' + width + ': ' + JSON.stringify({ actual, expected, left: style.paddingLeft, right: style.paddingRight }));
          }
          rows.push({ viewport: width, id, width: actual });
        }
        if (doc.body.scrollWidth > view.innerWidth) throw new Error('Document overflows at ' + width);
      }
      document.getElementById('layout-result').textContent = 'PASS ' + JSON.stringify(rows);
    } catch (error) { document.getElementById('layout-result').textContent = 'FAIL ' + error.message; }
  </script>`);
  const result = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--host-resolver-rules=MAP * ~NOTFOUND', `--user-data-dir=${join(dir, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30_000, maxBuffer: 2_000_000 });
  const output = result.stdout?.match(/<pre id="layout-result">([\s\S]*?)<\/pre>/)?.[1];
  if (result.status !== 0 || !output?.startsWith('PASS ')) throw new Error(output || result.error?.message || result.stderr);
  console.log(output);
} finally { rmSync(dir, { recursive: true, force: true }); }
