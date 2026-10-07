import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A linker signature on the inner Mach-O is not a signed application bundle. */
export function validateSignature(details: string, identifier: string): void {
  if (!details.split(/\r?\n/).includes(`Identifier=${identifier}`)) {
    throw new Error(`macOS signing identifier must match ${identifier}`);
  }
  if (details.includes('linker-signed')) throw new Error('macOS bundle still has only a linker-generated signature');
  if (!/^Info\.plist entries=\d+$/m.test(details) || !/^Sealed Resources version=\d+/m.test(details)) {
    throw new Error('macOS signature must bind Info.plist and seal bundle resources');
  }
}

export function verifyMacosBundle(app: string, identifier: string): void {
  for (const args of [['--verify', '--strict', '--verbose=2', app], ['-dv', '--verbose=4', app]]) {
    const result = spawnSync('codesign', args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `codesign exited ${result.status}`);
    if (args[0] === '-dv') validateSignature(result.stderr, identifier);
  }
  console.log(`Verified macOS bundle signature: ${app} (${identifier})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.platform === 'darwin') {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const target = process.env.CARGO_TARGET_DIR || 'src-tauri/target';
  const app = process.argv[2] || path.join(target, 'release', 'bundle', 'macos', `${config.productName}.app`);
  verifyMacosBundle(app, config.identifier);
}
