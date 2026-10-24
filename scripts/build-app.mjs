import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function run(args) {
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === 'darwin') {
  run(['run', 'tauri', 'build', '--', '--bundles', 'app']);
  run(['run', 'verify:bundle']);
} else if (process.platform === 'linux') {
  // The local launcher uses an executable and adjacent resources, not an installer.
  run(['run', 'tauri', 'build', '--', '--no-bundle']);
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const output = path.resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target', 'release');
  for (const [source, destination] of Object.entries(config.bundle.resources)) {
    const target = path.join(output, destination);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.resolve('src-tauri', source), target, { recursive: true, force: true });
  }
  const host = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  if (host.error || host.status !== 0) throw new Error('Cannot determine the native Rust target');
  const triple = host.stdout.match(/^host: (.+)$/m)?.[1];
  if (!triple) throw new Error('Missing Rust host target');
  cpSync(`src-tauri/resources/plugin-compiler/esbuild-${triple}`, path.join(output, 'esbuild'));
  console.log(`Built Linux executable, compiler and runtime resources in ${output}`);
} else {
  throw new Error(`Local app builds are not configured for ${process.platform}`);
}
