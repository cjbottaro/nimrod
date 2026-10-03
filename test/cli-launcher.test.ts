import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Only disposable files and intercepted exec calls: never invokes open or Nimrod.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nimrod-cli-')));
  const repo = join(root, 'checkout with spaces');
  const workspace = join(root, 'project ü');
  const launcher = join(repo, 'bin/nimrod');
  const installer = join(repo, 'scripts/install-cli.sh');
  const app = join(repo, 'src-tauri/target/release/bundle/macos/Nimrod.app');
  for (const directory of [workspace, dirname(launcher), dirname(installer), join(app, 'Contents/MacOS')]) mkdirSync(directory, { recursive: true });
  copyFileSync('bin/nimrod', launcher); chmodSync(launcher, 0o755);
  copyFileSync('scripts/install-cli.sh', installer);
  writeFileSync(join(app, 'Contents/MacOS/nimrod'), 'fixture only', { mode: 0o755 });
  const run = (args: string[], script = launcher, extraEnv: Record<string, string> = {}) => spawnSync('/bin/bash', ['-c', `
    script=$1; shift
    uname() { printf '%s\\n' "$FIXTURE_OS"; }
    exec() { printf '%s\\0' "$@"; }
    source "$script" "$@"
  `, '_', script, ...args], { cwd: workspace, encoding: 'utf8', env: { ...process.env, NIMROD_APP: '', FIXTURE_OS: 'Darwin', ...extraEnv } });
  return { root, repo, workspace, launcher, installer, app, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

const posix = process.platform !== 'win32';
test('Bash launcher resolves current directory and passes exact launch arguments without shell interpolation', { skip: !posix }, () => {
  const f = fixture();
  try {
    for (const args of [[], ['.'], [f.workspace]]) {
      const result = f.run(args);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.split('\0').filter(Boolean), ['/usr/bin/open', '-n', '-a', f.app, '--args', '--workspace', f.workspace]);
    }
    const special = join(f.workspace, '$(not-a-command); space'); mkdirSync(special);
    const result = f.run(['$(not-a-command); space']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\0').at(-2), special);
  } finally { f.close(); }
});

test('Bash launcher canonicalizes aliases and supports directories beginning with a dash', { skip: !posix }, () => {
  const f = fixture();
  try {
    symlinkSync(f.workspace, join(f.root, 'alias'));
    assert.equal(f.run(['../alias']).stdout.split('\0').at(-2), f.workspace);
    mkdirSync(join(f.workspace, '-project'));
    const result = f.run(['--', '-project']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\0').at(-2), join(f.workspace, '-project'));
  } finally { f.close(); }
});

test('Bash launcher rejects invalid input and missing builds before asking the OS to launch', { skip: !posix }, () => {
  const f = fixture();
  try {
    writeFileSync(join(f.workspace, 'file'), 'not a directory');
    for (const args of [['missing'], ['file'], ['a', 'b'], ['--unknown'], ['']]) {
      const result = f.run(args); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    }
    const result = f.run(['.'], f.launcher, { NIMROD_APP: join(f.root, 'missing.app') });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Build not found/); assert.equal(result.stdout, '');
    const help = f.run(['--help'], f.launcher, { NIMROD_APP: join(f.root, 'missing.app') });
    assert.equal(help.status, 0); assert.match(help.stdout, /Usage: nimrod/); assert.match(help.stdout, /Open or focus a project/); assert.doesNotMatch(help.stdout, /workspace|\/usr\/bin\/open/);
    assert.match(f.run(['missing']).stderr, /Not a project directory/);
    assert.match(f.run(['a', 'b']).stderr, /Expected one project directory/);
  } finally { f.close(); }
});

test('installed symlink resolves its checkout and installer refuses to replace another command', { skip: !posix }, () => {
  const f = fixture();
  try {
    const bin = join(f.root, 'user bin');
    const install = () => spawnSync('/bin/bash', [f.installer, bin], { encoding: 'utf8' });
    assert.equal(install().status, 0);
    const link = join(bin, 'nimrod'); assert.equal(readlinkSync(link), f.launcher);
    assert.equal(install().status, 0); // idempotent
    const run = f.run(['.'], link); assert.equal(run.status, 0, run.stderr); assert.ok(run.stdout.includes(f.app));
    rmSync(link); writeFileSync(link, 'existing command');
    assert.notEqual(install().status, 0); assert.equal(readFileSync(link, 'utf8'), 'existing command');
    rmSync(link); symlinkSync(join(bin, 'absent-command'), link);
    assert.notEqual(install().status, 0); assert.equal(readlinkSync(link), join(bin, 'absent-command'));
    assert.equal(existsSync(join(f.root, '.bashrc')), false);
  } finally { f.close(); }
});
