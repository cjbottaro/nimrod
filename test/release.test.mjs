import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assembleRelease, assertCaskUpgrade, assetName, extractReleaseNotes, publishRelease, readVersions, releaseMetadata, renderCask } from '../scripts/release.mjs';

const repository = 'cjbottaro/nimrod';
const metadata = version => releaseMetadata(`v${version}`, repository, { fixture: version });
const sha = arch => createHash('sha256').update(`fixture-${arch}`).digest('hex');
const checksums = { arm64: sha('arm64') };
const stableNotes = '### Fixed\n\n- Stable user-visible fix.\n';
const previewNotes = '### Added\n\n- Upcoming user-visible feature.\n';
const changelog = `# Changelog\n\n## Unreleased\n\n${previewNotes}\n## 0.1.0 — 2026-10-15\n\n${stableNotes}\n## 0.0.9 — 2026-09-01\n\n### Fixed\n\n- Older fix.\n`;
function fixture(version = '0.1.0') {
  const root = mkdtempSync(path.join(tmpdir(), 'nimrod-release-test-'));
  writeFileSync(path.join(root, assetName(version, 'arm64')), 'fixture-arm64');
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}
function publicationFixture(version = '0.1.0') {
  const f = fixture(version);
  assembleRelease(metadata(version), f.root, changelog);
  return f;
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

test('Cargo version discovery reads the whole package table without leaking into other tables', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nimrod-release-versions-'));
  try {
    mkdirSync(path.join(root, 'src-tauri'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(path.join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "nimrod"\nversion = "1.2.3"\n');
    const cargoFile = path.join(root, 'src-tauri/Cargo.toml');
    const packageTable = '[package]\nname = "nimrod"\n\n# Version follows other fields and blank lines.\nversion = "1.2.3"\n';
    for (const cargo of [
      `${packageTable}\n[dependencies]\nversion = "9.9.9"\n`,
      packageTable.trimEnd(),
      `[dependencies]\nversion = "9.9.9"\n\n${packageTable}`,
    ]) {
      for (const newline of ['\n', '\r\n']) {
        writeFileSync(cargoFile, cargo.replaceAll('\n', newline));
        const versions = readVersions(root);
        assert.equal(versions['Cargo.toml'], '1.2.3');
        assert.doesNotThrow(() => releaseMetadata('v1.2.3', repository, versions));
      }
    }
    for (const cargo of [
      '[package]\nname = "nimrod"\n\n[dependencies]\nversion = "1.2.3"\n',
      '[package]\nname = "nimrod"\n\n[package.metadata]\nversion = "1.2.3"\n',
      '[dependencies]\nversion = "1.2.3"\n',
    ]) {
      writeFileSync(cargoFile, cargo);
      const versions = readVersions(root);
      assert.equal(versions['Cargo.toml'], undefined);
      assert.throws(() => releaseMetadata('v1.2.3', repository, versions), /Cargo.toml version undefined/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stable notes select only the exact dated version; previews snapshot Unreleased without clearing it', () => {
  assert.equal(extractReleaseNotes(metadata('0.1.0'), changelog), stableNotes);
  assert.equal(extractReleaseNotes(metadata('0.2.0-alpha.1'), changelog), previewNotes);
  assert.equal(extractReleaseNotes(metadata('0.1.0'), `\uFEFF${changelog.replaceAll('\n', '\r\n')}`), stableNotes);
  assert.ok(changelog.includes(`## Unreleased\n\n${previewNotes}`));
  assert.throws(() => extractReleaseNotes(metadata('0.2.0'), changelog), /exactly one ## 0.2.0/);
});

test('release notes reject missing, duplicated, undated, invalid-date and empty target sections', () => {
  for (const source of ['', '## 0.1.0 — 2026-10-15\n- Fix.', `${changelog}\n## Unreleased\n- Duplicate.`]) {
    assert.throws(() => extractReleaseNotes(metadata('0.1.0'), source), /exactly one ## Unreleased/);
  }
  assert.throws(() => extractReleaseNotes(metadata('0.1.0'), `${changelog}\n## 0.1.0 — 2026-10-16\n- Duplicate.`), /exactly one ## 0.1.0/);
  for (const heading of ['0.1.0', '0.1.0 — yesterday', '0.1.0 — 2026-02-30', '0.1.0 — 2026-13-01']) {
    assert.throws(() => extractReleaseNotes(metadata('0.1.0'), `## Unreleased\n\n## ${heading}\n- Fix.`), /Invalid release date/);
  }
  for (const body of ['', '   ', '---', '***', '### Fixed\n\n<!-- TODO: write notes -->', '### Added\n\n- ']) {
    assert.throws(() => extractReleaseNotes(metadata('0.1.0'), `## Unreleased\n\n## 0.1.0 — 2026-10-15\n${body}`), /no release notes/);
    assert.throws(() => extractReleaseNotes(metadata('0.2.0-alpha.1'), `## Unreleased\n${body}\n## 0.1.0 — 2026-10-15\n- Old fix.`), /no release notes/);
  }
});

test('notes retain fenced examples without treating their headings as release boundaries', () => {
  for (const marker of ['```', '~~~~']) {
    const body = `### Added\n\n- Supports an example:\n\n${marker}markdown\n## Unreleased\n## 0.1.0 — 2026-10-15\n<!-- literal example -->\n${marker}\n`;
    const source = `# Changelog\n<!--\n## Unreleased\n-->\n## Unreleased\n\n${body}\n## 0.1.0 — 2026-10-15\n- Old fix.\n`;
    assert.equal(extractReleaseNotes(metadata('0.2.0-alpha.1'), source), body);
  }
  for (const ending of ['```\n## fake', '<!-- unfinished']) {
    assert.throws(() => extractReleaseNotes(metadata('0.2.0-alpha.1'), `## Unreleased\n- Feature.\n${ending}`), /unterminated/);
  }
});

test('metadata preflight gates tags on changelog notes before build/publish and leaves source untouched', () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.root, 'src-tauri'));
    const output = path.join(f.root, 'outputs');
    for (const [version, notes, success] of [
      ['0.1.0', changelog, true],
      ['0.1.0', '## Unreleased\n- Not yet released.\n', false],
      ['0.1.0', '## Unreleased\n\n## 0.1.0 — 2026-10-15\n', false],
      ['0.2.0-alpha.1', changelog, true],
    ]) {
      writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ version }));
      writeFileSync(path.join(f.root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
      writeFileSync(path.join(f.root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }));
      writeFileSync(path.join(f.root, 'src-tauri/Cargo.toml'), `[package]\nname = "nimrod"\nversion = "${version}"\n`);
      writeFileSync(path.join(f.root, 'src-tauri/Cargo.lock'), `[[package]]\nname = "nimrod"\nversion = "${version}"\n`);
      writeFileSync(path.join(f.root, 'CHANGELOG.md'), notes);
      writeFileSync(output, '');
      const result = spawnSync(process.execPath, [path.resolve('scripts/release.mjs'), 'metadata'], {
        cwd: f.root, encoding: 'utf8',
        env: { ...process.env, RELEASE_TAG: `v${version}`, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: output },
      });
      assert.equal(result.status === 0, success, result.stderr);
      assert.equal(readFileSync(output, 'utf8').includes(`version=${version}`), success);
      assert.equal(readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'), notes);
    }
  } finally { f.close(); }
});

test('release workflow and verifier use only the native ARM target', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  const verifier = readFileSync('scripts/verify-release-macos.sh', 'utf8');
  assert.match(workflow, /--target aarch64-apple-darwin/);
  assert.match(workflow, /name: macos-arm64/);
  assert.match(workflow, /Validate tag, package versions and changelog notes/);
  assert.match(verifier, /lipo -archs.*== arm64/);
  assert.doesNotMatch(workflow + verifier, /macos-15-intel|x86_64|x64|matrix\./);
});

test('cask is ARM-only with an immutable URL, final checksum and packaged CLI', () => {
  const cask = renderCask(metadata('0.1.0'), checksums);
  assert.ok(cask.includes(`sha256 "${checksums.arm64}"`));
  assert.ok(cask.includes('https://github.com/cjbottaro/nimrod/releases/download/v#{version}/Nimrod-#{version}-macos-arm64.dmg'));
  assert.match(cask, /depends_on arch: :arm64/);
  assert.match(cask, /depends_on macos: ">= :ventura"/);
  assert.ok(cask.includes('binary "#{appdir}/Nimrod.app/Contents/Resources/bin/nimrod"'));
  assert.doesNotMatch(cask, /intel|x64|no_check|quarantine|zap|uninstall/);
  assert.throws(() => renderCask(metadata('0.2.0-alpha.1'), checksums), /Prereleases/);
  assert.throws(() => renderCask(metadata('0.1.0'), { arm64: 'bad' }), /Invalid arm64/);
});

test('release assembly hashes the actual DMG bytes and omits a prerelease cask', () => {
  for (const version of ['0.1.0', '0.2.0-alpha.1']) {
    const f = fixture(version);
    try {
      assembleRelease(metadata(version), f.root, changelog);
      const sums = readFileSync(path.join(f.root, 'SHA256SUMS'), 'utf8');
      assert.equal(sums, `${sha('arm64')}  ${assetName(version, 'arm64')}\n`);
      assert.equal(readFileSync(path.join(f.root, 'release-notes.md'), 'utf8'), version.includes('-') ? previewNotes : stableNotes);
      assert.equal(existsSync(path.join(f.root, 'nimrod.rb')), !version.includes('-'));
    } finally { f.close(); }
  }
});

test('missing ARM artifact or changelog notes fail assembly; Intel/universal assets are unsupported', () => {
  const f = fixture();
  try {
    assert.throws(() => assembleRelease(metadata('0.1.0'), f.root, '## Unreleased\n- Feature.'), /exactly one ## 0.1.0/);
    assert.equal(existsSync(path.join(f.root, 'SHA256SUMS')), false);
    rmSync(path.join(f.root, assetName('0.1.0', 'arm64')));
    assert.throws(() => assembleRelease(metadata('0.1.0'), f.root, changelog), /ENOENT/);
    assert.equal(existsSync(path.join(f.root, 'SHA256SUMS')), false);
    for (const arch of ['x64', 'x86_64', 'universal']) assert.throws(() => assetName('0.1.0', arch), /Unsupported/);
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
  const f = publicationFixture();
  try {
    const calls = [];
    assert.throws(() => publishRelease({ ...metadata('0.1.0'), commit: 'a'.repeat(40) }, f.root, args => {
      calls.push(args);
      return 'b'.repeat(40);
    }), /tag moved/);
    assert.deepEqual(calls, [['api', 'repos/cjbottaro/nimrod/commits/v0.1.0', '--jq', '.sha']]);
  } finally { f.close(); }
});

test('publication creates a draft with changelog notes, uploads ARM assets, then publishes it', () => {
  const f = publicationFixture();
  try {
    const calls = [];
    publishRelease(metadata('0.1.0'), f.root, args => {
      calls.push(args);
      return args[0] === 'api' ? '[[]]' : '';
    });
    assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'create'], ['release', 'upload'], ['release', 'edit']]);
    assert.ok(calls[1].includes('--draft'));
    for (const call of [calls[1], calls[3]]) {
      assert.equal(readFileSync(call[call.indexOf('--notes-file') + 1], 'utf8'), stableNotes);
    }
    for (const name of ['Nimrod-0.1.0-macos-arm64.dmg', 'nimrod.rb', 'SHA256SUMS', 'release-notes.md']) {
      assert.ok(calls[2].includes(path.join(f.root, name)));
    }
    assert.ok(calls[3].includes('--draft=false'));
    assert.ok(calls[3].includes('--latest=true'));
    assert.doesNotMatch(calls.flat().join(' '), /--generate-notes|macos-x64/);
  } finally { f.close(); }
});

test('prerelease publication uses Unreleased notes, never includes a cask or takes the latest stable slot', () => {
  const f = publicationFixture('0.2.0-alpha.1');
  try {
    const calls = [];
    publishRelease(metadata('0.2.0-alpha.1'), f.root, args => {
      calls.push(args);
      return args[0] === 'api' ? '[[]]' : '';
    });
    assert.ok(calls[1].includes('--prerelease'));
    assert.equal(readFileSync(calls[1][calls[1].indexOf('--notes-file') + 1], 'utf8'), previewNotes);
    assert.ok(calls[3].includes('--latest=false'));
    assert.ok(calls[3].includes('--prerelease=true'));
    assert.doesNotMatch(calls.flat().join(' '), /nimrod\.rb|--generate-notes/);
  } finally { f.close(); }
});

test('missing or empty assembled notes fail before any GitHub request', () => {
  const f = publicationFixture();
  try {
    const notes = path.join(f.root, 'release-notes.md');
    rmSync(notes);
    const runGh = () => assert.fail('Must not contact GitHub without release notes');
    assert.throws(() => publishRelease(metadata('0.1.0'), f.root, runGh), /ENOENT/);
    writeFileSync(notes, ' \n');
    assert.throws(() => publishRelease(metadata('0.1.0'), f.root, runGh), /must contain/);
  } finally { f.close(); }
});

test('API and upload failures never publish; draft retries reuse the release and refresh notes', () => {
  const f = publicationFixture();
  try {
    assert.throws(() => publishRelease(metadata('0.1.0'), f.root, () => { throw new Error('API unavailable'); }), /API unavailable/);
    for (const failUpload of [true, false]) {
      const calls = [];
      const run = () => publishRelease(metadata('0.1.0'), f.root, args => {
        calls.push(args);
        if (args[0] === 'api') return '[[{"tag_name":"v0.1.0","draft":true,"body":"stale draft notes"}]]';
        if (args[1] === 'upload' && failUpload) throw new Error('upload failed');
        return '';
      });
      if (failUpload) {
        assert.throws(run, /upload failed/);
        assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'upload']]);
      } else {
        assert.doesNotThrow(run);
        assert.deepEqual(calls.map(args => args.slice(0, 2)), [['api', '--paginate'], ['release', 'upload'], ['release', 'edit']]);
        assert.equal(readFileSync(calls[2][calls[2].indexOf('--notes-file') + 1], 'utf8'), stableNotes);
      }
    }
  } finally { f.close(); }
});

test('older stable releases cannot replace the latest or downgrade Homebrew', () => {
  const f = publicationFixture();
  try {
    const calls = [];
    assert.throws(() => publishRelease(metadata('0.1.0'), f.root, args => {
      calls.push(args);
      return '[[{"tag_name":"v0.2.0","draft":false,"prerelease":false}]]';
    }), /downgrade/);
    assert.equal(calls.length, 1);
  } finally { f.close(); }
});

test('published retries are read-only and require identical notes, notes asset and signed ARM artifact', () => {
  const f = publicationFixture();
  try {
    for (const corrupt of [undefined, 'body', 'Nimrod-0.1.0-macos-arm64.dmg', 'release-notes.md']) {
      const calls = [];
      const run = () => publishRelease(metadata('0.1.0'), f.root, args => {
        calls.push(args);
        if (args[0] === 'api') return JSON.stringify([[{ tag_name: 'v0.1.0', draft: false, prerelease: false, body: corrupt === 'body' ? 'Different notes' : stableNotes }]]);
        const destination = args[args.indexOf('--dir') + 1];
        for (const file of ['Nimrod-0.1.0-macos-arm64.dmg', 'SHA256SUMS', 'release-notes.md', 'nimrod.rb']) {
          copyFileSync(path.join(f.root, file), path.join(destination, file));
        }
        if (corrupt) writeFileSync(path.join(destination, corrupt), 'different bytes');
        return '';
      });
      if (corrupt) assert.throws(run, corrupt === 'body' ? /Published release notes differ/ : /Published asset differs/);
      else assert.doesNotThrow(run);
      assert.deepEqual(calls.map(args => args.slice(0, 2)), corrupt === 'body' ? [['api', '--paginate']] : [['api', '--paginate'], ['release', 'download']]);
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
