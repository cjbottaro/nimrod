import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const buildScript = path.resolve('scripts/build-app.mjs');

// Only command stubs are on PATH: these fixtures cannot build or enter a real box.
function invokeBuild(box: string | undefined, container: string, exitStatus: number) {
  const directory = mkdtempSync(path.join(tmpdir(), 'nimrod-build-'));
  const log = path.join(directory, 'commands.json');
  try {
    for (const command of ['npm', 'distrobox']) {
      writeFileSync(path.join(directory, command), `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.BUILD_TEST_LOG, JSON.stringify({
  command: ${JSON.stringify(command)}, args: process.argv.slice(2), cwd: process.cwd(),
}));
process.exit(Number(process.env.BUILD_TEST_STATUS));
`, { mode: 0o755 });
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: directory,
      CONTAINER_ID: container,
      BUILD_TEST_LOG: log,
      BUILD_TEST_STATUS: String(exitStatus),
    };
    delete env.NIMROD_BUILD_DISTROBOX;
    if (box !== undefined) env.NIMROD_BUILD_DISTROBOX = box;
    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory, env, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, exitStatus, result.stderr);
    return { ...JSON.parse(readFileSync(log, 'utf8')), expectedCwd: directory };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const linuxOnly = { skip: process.platform !== 'linux' };

test('Linux delegates to the configured Distrobox from host or another box', linuxOnly, () => {
  for (const container of ['', 'another-box']) {
    const result = invokeBuild('  my-devbox  ', container, 0);
    assert.equal(result.command, 'distrobox');
    assert.deepEqual(result.args, ['enter', '--name', 'my-devbox', '--', 'mise', 'run', 'build']);
    assert.equal(result.cwd, result.expectedCwd);
  }
});

test('Linux does not delegate without a configured box or when already inside it', linuxOnly, () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, ''], ['', ''], ['   ', ''], ['devbox', 'devbox'],
  ];
  for (const [box, container] of cases) {
    // Stop at npm, before resource staging; no native compilation is performed.
    const result = invokeBuild(box, container, 23);
    assert.equal(result.command, 'npm');
    assert.deepEqual(result.args, ['run', 'tauri', 'build', '--', '--no-bundle']);
  }
});

test('Linux propagates a delegated failure without attempting a host build', linuxOnly, () => {
  assert.equal(invokeBuild('devbox', '', 17).command, 'distrobox');
});
