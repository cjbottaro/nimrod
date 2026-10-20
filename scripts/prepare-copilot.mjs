import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const destination = new URL('../src-tauri/resources/copilot/', import.meta.url);
const platform = ({ macos: 'darwin', windows: 'win32' })[process.env.NIMROD_COPILOT_TARGET_OS] || process.env.NIMROD_COPILOT_TARGET_OS || process.platform;
const arch = ({ aarch64: 'arm64', x86_64: 'x64' })[process.env.NIMROD_COPILOT_TARGET_ARCH] || process.env.NIMROD_COPILOT_TARGET_ARCH || process.arch;
if (platform !== process.platform || arch !== process.arch)
  throw new Error('Copilot SDK staging currently requires a native same-platform/architecture build; no host-native dependency will be packaged for a different target.');
// Only this generated asset directory is replaced; stale optional runtimes
// must never survive a previous staging run.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of ['bridge.mjs', 'configuration.mjs', 'config-command.mjs', 'command-effects.mjs', 'permissions.mjs'])
  await cp(new URL(`../copilot/${file}`, import.meta.url), new URL(file, destination));
// Ship the SDK and its dependencies, never the SDK's optional Copilot runtime.
for (const name of ['@github/copilot-sdk', 'vscode-jsonrpc', 'zod', 'koffi', `@koromix/koffi-${platform}-${arch}`]) {
  let directory = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate ${name}`);
    directory = parent;
  }
  const target = new URL(`node_modules/${name}/`, destination);
  await mkdir(target, { recursive: true });
  if (name === '@github/copilot-sdk') {
    await cp(join(directory, 'dist'), new URL('dist/', target), { recursive: true });
    await cp(join(directory, 'package.json'), new URL('package.json', target));
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (manifest.version !== '1.0.22' || manifest.copilotCliVersion !== '1.0.98') throw new Error('Unexpected Copilot SDK release');
  } else await cp(directory, target, { recursive: true });
}
await writeFile(new URL('package.json', destination), '{"private":true,"type":"module"}\n');
async function sign(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) await sign(path);
    else if (process.platform === 'darwin' && /\.(node|dylib)$/.test(entry.name)) {
      const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
      execFileSync('codesign', ['--force', '--sign', identity, ...(identity === '-' ? [] : ['--options', 'runtime', '--timestamp']), fileURLToPath(path)], { stdio: 'inherit' });
    }
  }
}
await sign(destination);
