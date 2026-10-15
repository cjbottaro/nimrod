import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const architectures = ['arm64', 'x64'];

export function releaseMetadata(tag, repository, versions) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag || '');
  if (!match || match[0] !== tag || match[4]?.split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error('Release tag must be vMAJOR.MINOR.PATCH, optionally with a SemVer prerelease suffix');
  }
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || /\s/.test(repository)) throw new Error('Invalid GitHub repository');
  const version = tag.slice(1);
  for (const [file, value] of Object.entries(versions)) {
    if (value !== version) throw new Error(`${file} version ${value} does not match release ${version}`);
  }
  if (!Object.keys(versions).length) throw new Error('No release versions supplied');
  return { tag, version, repository, prerelease: Boolean(match[4]) };
}

export function readVersions(root = '.') {
  const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const lock = json('package-lock.json');
  const cargo = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
  return {
    'package.json': json('package.json').version,
    'package-lock.json': lock.version,
    'package-lock.json root': lock.packages?.['']?.version,
    'tauri.conf.json': json('src-tauri/tauri.conf.json').version,
    'Cargo.toml': /^\[package\]\s*\n([\s\S]*?)(?=\n\[|$)/m.exec(cargo)?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    'Cargo.lock': cargoLock.split('[[package]]').find(block => /^name = "nimrod"$/m.test(block))?.match(/^version = "([^"]+)"/m)?.[1],
  };
}

export function assetName(version, arch) {
  if (!architectures.includes(arch)) throw new Error(`Unsupported release architecture: ${arch}`);
  return `Nimrod-${version}-macos-${arch}.dmg`;
}

export function renderCask(metadata, checksums) {
  // Validate again: these values become Ruby source and immutable download URLs.
  releaseMetadata(metadata.tag, metadata.repository, { cask: metadata.version });
  if (metadata.prerelease || metadata.version.includes('-')) throw new Error('Prereleases must not update the stable Homebrew cask');
  for (const arch of architectures) {
    if (!/^[a-f0-9]{64}$/.test(checksums[arch] || '')) throw new Error(`Invalid ${arch} checksum`);
  }
  return `cask "nimrod" do
  arch arm: "arm64", intel: "x64"

  version "${metadata.version}"
  sha256 arm:   "${checksums.arm64}",
         intel: "${checksums.x64}"

  url "https://github.com/${metadata.repository}/releases/download/v#{version}/Nimrod-#{version}-macos-#{arch}.dmg"
  name "Nimrod"
  desc "Dedicated desktop workspace for coding agents"
  homepage "https://github.com/${metadata.repository}"

  depends_on macos: ">= :ventura"

  app "Nimrod.app"
  binary "#{appdir}/Nimrod.app/Contents/Resources/bin/nimrod"

  caveats "Requires a separately installed Node.js and Pi runtime, with Pi authentication configured."
end
`;
}

export function assembleRelease(metadata, directory) {
  const checksums = {};
  const entries = architectures.map(arch => {
    const name = assetName(metadata.version, arch);
    const digest = createHash('sha256').update(readFileSync(path.join(directory, name))).digest('hex');
    checksums[arch] = digest;
    return `${digest}  ${name}\n`;
  });
  writeFileSync(path.join(directory, 'SHA256SUMS'), entries.join(''));
  if (!metadata.prerelease) writeFileSync(path.join(directory, 'nimrod.rb'), renderCask(metadata, checksums));
}

export function assertCaskUpgrade(current, nextVersion) {
  const existing = current.match(/^\s*version "([^"]+)"$/m)?.[1];
  if (!existing || !/^\d+\.\d+\.\d+$/.test(existing)) throw new Error('Existing cask must contain a stable numeric version');
  if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) throw new Error('Next cask version must be stable and numeric');
  const before = existing.split('.').map(part => BigInt(part));
  const after = nextVersion.split('.').map(part => BigInt(part));
  for (let i = 0; i < 3; i++) {
    if (after[i] > before[i]) return;
    if (after[i] < before[i]) throw new Error(`Refusing Homebrew downgrade from ${existing} to ${nextVersion}`);
  }
  // Equal versions are allowed only for byte-identical retries (checked by caller).
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `gh exited ${result.status}`);
  return result.stdout;
}

export function publishRelease(metadata, directory, runGh = gh) {
  if (metadata.commit) {
    const actual = runGh(['api', `repos/${metadata.repository}/commits/${metadata.tag}`, '--jq', '.sha']).trim();
    if (actual !== metadata.commit) throw new Error('Release tag moved after preparation; refusing to publish assets for another commit');
  }
  // A transient API failure must not be mistaken for an absent release.
  const releases = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${metadata.repository}/releases?per_page=100`])).flat();
  const existing = releases.find(release => release.tag_name === metadata.tag);
  const files = [...architectures.map(arch => assetName(metadata.version, arch)), 'SHA256SUMS', ...(!metadata.prerelease ? ['nimrod.rb'] : [])];
  if (existing && !existing.draft) {
    // Retry a failed publish job with the SAME retained build artifacts, never
    // overwrite a public release with a fresh build (signatures/tickets differ).
    if (existing.prerelease !== metadata.prerelease) throw new Error('Published release status does not match the tag');
    const download = mkdtempSync(path.join(tmpdir(), 'nimrod-release-'));
    try {
      runGh(['release', 'download', metadata.tag, '--repo', metadata.repository, '--dir', download, ...files.flatMap(file => ['--pattern', file])]);
      for (const file of files) {
        if (!readFileSync(path.join(download, file)).equals(readFileSync(path.join(directory, file)))) {
          throw new Error(`Published asset differs: ${file}. Never replace published assets; re-run only failed jobs with the original artifacts.`);
        }
      }
    } finally { rmSync(download, { recursive: true, force: true }); }
    return;
  }
  if (!metadata.prerelease) {
    for (const release of releases) {
      if (!release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
        assertCaskUpgrade(`version "${release.tag_name.slice(1)}"`, metadata.version);
      }
    }
  }
  if (!existing) {
    runGh(['release', 'create', metadata.tag, '--repo', metadata.repository, '--verify-tag', '--draft', '--title', `Nimrod ${metadata.version}`, '--generate-notes', ...(metadata.prerelease ? ['--prerelease'] : [])]);
  }
  runGh(['release', 'upload', metadata.tag, '--repo', metadata.repository, '--clobber', ...files.map(file => path.join(directory, file))]);
  runGh(['release', 'edit', metadata.tag, '--repo', metadata.repository, '--draft=false', `--prerelease=${metadata.prerelease}`, `--latest=${!metadata.prerelease}`]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metadata = releaseMetadata(process.env.RELEASE_TAG, process.env.GITHUB_REPOSITORY, readVersions());
  const [command, ...args] = process.argv.slice(2);
  if (command === 'metadata') {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${metadata.tag}\nversion=${metadata.version}\nprerelease=${metadata.prerelease}\n`);
  } else if (command === 'stage') {
    const [arch, bundle, destination] = args;
    const dmgs = readdirSync(path.join(bundle, 'dmg')).filter(file => file.endsWith('.dmg'));
    if (dmgs.length !== 1) throw new Error('Expected exactly one DMG from a clean release build');
    mkdirSync(destination, { recursive: true });
    copyFileSync(path.join(bundle, 'dmg', dmgs[0]), path.join(destination, assetName(metadata.version, arch)));
  } else if (command === 'publish') {
    metadata.commit = process.env.RELEASE_COMMIT;
    const checkout = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (!/^[a-f0-9]{40}$/.test(metadata.commit || '') || checkout.status !== 0 || checkout.stdout.trim() !== metadata.commit) {
      throw new Error('RELEASE_COMMIT must match the prepared source checkout');
    }
    assembleRelease(metadata, args[0]);
    publishRelease(metadata, args[0]);
  } else if (command === 'check-cask-upgrade') {
    const current = readFileSync(args[0], 'utf8');
    const next = readFileSync(args[1], 'utf8');
    assertCaskUpgrade(current, metadata.version);
    if (current.match(/^\s*version "([^"]+)"$/m)?.[1] === metadata.version && current !== next) {
      throw new Error('Refusing to replace checksums/content for an existing cask version');
    }
  } else {
    throw new Error('Usage: node scripts/release.mjs metadata | stage ARCH BUNDLE_DIR OUTPUT_DIR | publish ASSET_DIR | check-cask-upgrade CURRENT NEXT');
  }
}
