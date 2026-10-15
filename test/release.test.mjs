import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assembleRelease, assertCaskUpgrade, assetName, publishRelease, readVersions, releaseMetadata, renderCask } from '../scripts/release.mjs';

const repository = 'cjbottaro/nimrod';
const metadata = version => releaseMetadata(`v${version}`, repository, { fixture: version });
const sha = arch => createHash('sha256').update(`fixture-${arch}`).digest('hex');
const checksums = { arm64: sha('arm64'), x64: sha('x64') };
function fixture(version = '0.1.0') {
  const root = mkdtempSync(path.join(tmpdir(), 'nimrod-release-test-'));
  for (const arch of ['arm64', 'x64']) writeFileSync(path.join(root, assetName(version, arch)), `fixture-${arch}`);
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('release metadata requires exact package/lock/config versions and safe SemVer tags', () => {
  assert.equal(metadata('0.1.0').prerelease, false);
  assert.equal(metadata('0.2.0-alpha.1').prerelease, true);
  for (const tag of ['0.1.0', 'v01.1.0', 'v0.1', 'v0.1.0-alpha.01', 'v0.1.0+build', 'v0.1.0\n', 'v0.1.0\nmalicious=true', 'v0.1.0;echo']) {
    assert.throws(() => releaseMetadata(tag, repository, { fixture: '0.1.0' }), /Release tag/);
  }
  assert.throws(() => releaseMetadata('v0.1.0', 'owner/#{inject}', { fixture: '0.1.0' }), /repository/);
  assert.throws(() => releaseMetadata('v0.1.0', repository, { missing: undefined }), /does not match/);
  assert.throws(() => releaseMetadata('v0.1.0', repository, { pkg: '0.1.0', lock: '0.0.9' }), /lock version/);
  assert.throws(() => releaseMetadata('v0.1.0', repository, {}), /No release versions/);
});

test('version discovery reads all six package/config/lock identities', () => {
  const versions = readVersions();
  assert.equal(Object.keys(versions).length, 6);
  assert.ok(Object.values(versions).every(version => typeof version === 'string' && version.length > 0));
  const version = versions['package.json'];
  assert.doesNotThrow(() => releaseMetadata(`v${version}`, repository, versions));
});

test('cask uses immutable per-architecture URLs and final checksums, including the packaged CLI', () => {
  const cask = renderCask(metadata('0.1.0'), checksums);
  assert.match(cask, /arch arm: "arm64", intel: "x64"/);
  for (const digest of Object.values(checksums)) assert.ok(cask.includes(digest));
  assert.ok(cask.includes('https://github.com/cjbottaro/nimrod/releases/download/v#{version}/Nimrod-#{version}-macos-#{arch}.dmg'));
  assert.match(cask, /depends_on macos: ">= :ventura"/);
  assert.ok(cask.includes('binary "#{appdir}/Nimrod.app/Contents/Resources/bin/nimrod"'));
  assert.doesNotMatch(cask, /no_check|quarantine|zap|uninstall/);
  assert.throws(() => renderCask(metadata('0.2.0-alpha.1'), checksums), /Prereleases/);
  assert.throws(() => renderCask(metadata('0.1.0'), { ...checksums, arm64: 'bad' }), /Invalid arm64/);
});

test('release assembly hashes the actual DMG bytes and omits a prerelease cask', () => {
  for (const version of ['0.1.0', '0.2.0-alpha.1']) {
    const f = fixture(version);
    try {
      assembleRelease(metadata(version), f.root);
      const sums = readFileSync(path.join(f.root, 'SHA256SUMS'), 'utf8');
      assert.equal(sums, ['arm64', 'x64'].map(arch => `${sha(arch)}  ${assetName(version, arch)}\n`).join(''));
      assert.equal(existsSync(path.join(f.root, 'nimrod.rb')), !version.includes('-'));
    } finally { f.close(); }
  }
});

test('missing architectures fail before release assembly/publishing', () => {
  const f = fixture();
  try {
    rmSync(path.join(f.root, assetName('0.1.0', 'x64')));
    assert.throws(() => assembleRelease(metadata('0.1.0'), f.root), /ENOENT/);
    assert.equal(existsSync(path.join(f.root, 'SHA256SUMS')), false);
    assert.throws(() => assetName('0.1.0', 'universal'), /Unsupported/);
  } finally { f.close(); }
});

test('tap upgrades compare numeric versions, allow idempotent versions and refuse downgrades', () => {
  assert.doesNotThrow(() => assertCaskUpgrade('  version "0.9.0"', '0.10.0'));
  assert.doesNotThrow(() => assertCaskUpgrade('  version "0.10.0"', '0.10.0'));
  assert.throws(() => assertCaskUpgrade('  version "0.10.0"', '0.9.0'), /downgrade/);
  assert.throws(() => assertCaskUpgrade('  version "1.0.0"', '0.99.0'), /downgrade/);
  assert.throws(() => assertCaskUpgrade('  version "latest"', '1.0.0'), /numeric version/);
  assert.throws(() => assertCaskUpgrade('  version "1.0.0"', '1.1.0-alpha.1'), /stable and numeric/);
});

test('tag movement after prepare is rejected before any publication mutation', () => {
  const calls = [];
  assert.throws(() => publishRelease({ ...metadata('0.1.0'), commit: 'a'.repeat(40) }, '/fixture', args => {
    calls.push(args);
    return 'b'.repeat(40);
  }), /tag moved/);
  assert.deepEqual(calls, [['api', 'repos/cjbottaro/nimrod/commits/v0.1.0', '--jq', '.sha']]);
});

test('publication creates a draft, uploads all assets, then publishes it', () => {
  const calls = [];
  publishRelease(metadata('0.1.0'), '/fixture', args => {
    calls.push(args);
    return args[0] === 'api' ? '[[]]' : '';
  });
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'create'], ['release', 'upload'], ['release', 'edit']]);
  assert.ok(calls[1].includes('--draft'));
  assert.ok(calls[2].includes('/fixture/nimrod.rb'));
  assert.ok(calls[2].includes('/fixture/SHA256SUMS'));
  assert.ok(calls[3].includes('--draft=false'));
  assert.ok(calls[3].includes('--latest=true'));
});

test('prerelease publication never includes a cask or takes the latest stable slot', () => {
  const calls = [];
  publishRelease(metadata('0.2.0-alpha.1'), '/fixture', args => {
    calls.push(args);
    return args[0] === 'api' ? '[[]]' : '';
  });
  assert.ok(calls[1].includes('--prerelease'));
  assert.ok(calls[3].includes('--latest=false'));
  assert.ok(calls[3].includes('--prerelease=true'));
  assert.doesNotMatch(calls.flat().join(' '), /nimrod\.rb/);
});

test('API and upload failures never publish; draft retries reuse the release', () => {
  assert.throws(() => publishRelease(metadata('0.1.0'), '/fixture', () => { throw new Error('API unavailable'); }), /API unavailable/);
  const calls = [];
  assert.throws(() => publishRelease(metadata('0.1.0'), '/fixture', args => {
    calls.push(args);
    if (args[0] === 'api') return '[[{"tag_name":"v0.1.0","draft":true}]]';
    if (args[1] === 'upload') throw new Error('upload failed');
    return '';
  }), /upload failed/);
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'upload']]);
});

test('older stable releases cannot replace the latest or downgrade Homebrew', () => {
  const calls = [];
  assert.throws(() => publishRelease(metadata('0.1.0'), '/fixture', args => {
    calls.push(args);
    return '[[{"tag_name":"v0.2.0","draft":false,"prerelease":false}]]';
  }), /downgrade/);
  assert.equal(calls.length, 1);
});

test('published retries are read-only and require identical original assets', () => {
  const f = fixture();
  try {
    assembleRelease(metadata('0.1.0'), f.root);
    for (const corrupt of [false, true]) {
      const calls = [];
      const run = () => publishRelease(metadata('0.1.0'), f.root, args => {
        calls.push(args);
        if (args[0] === 'api') return '[[{"tag_name":"v0.1.0","draft":false,"prerelease":false}]]';
        const destination = args[args.indexOf('--dir') + 1];
        for (const file of ['Nimrod-0.1.0-macos-arm64.dmg', 'Nimrod-0.1.0-macos-x64.dmg', 'SHA256SUMS', 'nimrod.rb']) {
          copyFileSync(path.join(f.root, file), path.join(destination, file));
        }
        if (corrupt) writeFileSync(path.join(destination, 'Nimrod-0.1.0-macos-arm64.dmg'), 'different signing bytes');
        return '';
      });
      if (corrupt) assert.throws(run, /Published asset differs/);
      else assert.doesNotThrow(run);
      assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'download']]);
    }
  } finally { f.close(); }
});

test('release overlay preserves local ad-hoc builds; the packaged CLI has a stable resource path', () => {
  const local = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const release = JSON.parse(readFileSync('src-tauri/tauri.release.conf.json', 'utf8'));
  assert.equal(local.bundle.macOS.signingIdentity, '-');
  assert.equal(release.bundle.macOS.signingIdentity, null);
  assert.equal(release.bundle.macOS.hardenedRuntime, true);
  assert.equal(release.bundle.macOS.minimumSystemVersion, '13.0');
  assert.deepEqual(release.bundle.targets, ['app', 'dmg']);
  assert.equal(local.bundle.resources['../bin/nimrod'], 'bin/nimrod');
});
