// One-time extraction from the local Pi GUI working tree; not part of normal builds.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const source = readFileSync('../pi-gui/src/webview.ts', 'utf8');
writeFileSync('src/pi/transcript.css', source.split('<style nonce="${nonce}">')[1].split('</style>')[0]);
const body = source.split('</style></head><body>')[1].split('<script nonce=')[0];
writeFileSync('src/pi/transcript.html', body);
for (const file of readdirSync('test')) {
  if (!file.endsWith('.ts')) continue;
  const path = `test/${file}`;
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('../src/', '../src/pi/'));
}
