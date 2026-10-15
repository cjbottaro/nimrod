# Release distribution

**Status: implemented, not executed against Apple/GitHub/Homebrew.** This is a macOS release pipeline, not cross-platform acceptance. Local builds retain ad-hoc signing. User instructions: [Installation](../../../../docs/installation.md). Operator setup: [Contributing](../../../../CONTRIBUTING.md#release-setup).

## Contract

- Version tags `vMAJOR.MINOR.PATCH` create stable releases; valid SemVer prerelease suffixes create GitHub prereleases only. Build metadata suffixes are deliberately unsupported.
- The tag must match package.json, package-lock.json (top-level and root package), Tauri config, Cargo.toml and the Nimrod Cargo.lock package. The tagged commit must be reachable from main. Every downstream checkout uses the prepare job's resolved commit, not a moving branch/tag; publication rechecks the remote tag's resolved commit before mutation.
- All releases are serialized by a workflow-wide concurrency group. Native Apple Silicon and Intel jobs use separate runners/dependencies, including target-native esbuild. The release macOS deployment floor is 13.0 on both architectures.
- Offline checks/fixture tests precede credential import. No Pi installation, provider request, user session, or native app launch is needed by the workflow.
- The app and compiler sidecar must have whole Developer ID signatures, the expected Team ID and hardened runtime; architecture checks cover both executables. The packaged Bash launcher must match source.
- Tauri notarizes/staples the app before DMG creation. The DMG is additionally submitted to notarytool and stapled explicitly. Stapler/Gatekeeper verification must succeed before artifact upload.
- Checksums and the Homebrew cask are generated from the final stapled DMG bytes, not intermediate files. Both architectures must pass before a release is published.
- Releases are assembled as drafts, uploaded, then made public. An upload/API failure cannot publish an incomplete new release. Draft retries may replace assets. Published assets are immutable: retries must download and byte-compare every expected asset before treating publication as already complete; fresh builds cannot silently replace signatures/checksums.
- Stable versions cannot move backwards relative to existing stable GitHub releases or the current cask. Same-version cask retries must be byte-identical. Prereleases never update the cask or take GitHub's latest stable slot.
- A tap failure does not roll back a public release. Re-run failed jobs with retained original artifacts; do not rebuild/re-sign a published version. Action artifacts expire after seven days; the published stable release also includes the exact `nimrod.rb` for manual recovery.
- Stable runs require a public Nimrod repository/releases for unauthenticated downloads. Homebrew uses a dedicated public tap, not homebrew/cask. Only `Casks/nimrod.rb` is committed, without force push. No quarantine bypass, custom install hooks, automatic runtime installation or uninstall data purge.
- Apple secrets are available only in the build job's named steps. Release write permission is limited to publication; the tap uses a separate repository-scoped token/environment. Each build imports a temporary keychain and raw .p8 into RUNNER_TEMP and deletes them in an always cleanup step. Signing setup refuses to run outside a GitHub macOS runner.
- Merely editing this pipeline does not authorize pushing tags, creating repositories/secrets, notarizing builds or publishing remotely.

## Code map

- `.github/workflows/release.yml`: tag/manual triggers, pinned source identity, two native builds, publication, stable tap update.
- `src-tauri/tauri.release.conf.json`: release-only DMG/app targets, null signing identity removes the local ad-hoc override so APPLE_SIGNING_IDENTITY applies, hardened runtime and deployment floor.
- `scripts/prepare-release-signing.sh`: environment preflight, temporary certificate/private-key setup.
- `scripts/verify-release-macos.sh`: app/helper/architecture/launcher verification, final DMG notarization/stapling/Gatekeeper checks without app execution.
- `scripts/release.mjs`: safe version/repository parsing, normalized asset names, checksums/cask generation, draft/publication and immutable retry/upgrade guards. Uses only Node built-ins and gh; no npm installation for metadata/publication jobs.
- `src-tauri/tauri.conf.json`: explicit resource map packages `bin/nimrod` at `Contents/Resources/bin/nimrod` and notices at the resource root while preserving the runtime extension/compiler-license paths.
- `bin/nimrod`: resolves Homebrew symlinks to its own containing bundle; source-checkout behavior and NIMROD_APP priority remain unchanged. Native launch routing stays owned by [single-instance startup](single-instance.md).
- `test/release.test.mjs`: built-in Node fixture tests for tag/version validation, checksum/cask generation, downgrade guards, draft ordering/failure and immutable retries; gh is injected and never called live.
- `test/cli-launcher.test.ts`: intercepted shell fixture includes a Homebrew-style relative symlink into a moved bundle and override precedence.

## Verification boundaries

No checks, tests, builds or release runs were executed when adding this pipeline. Fixtures are authored, not claimed passing. First-run acceptance must establish runner/tool availability, imported Developer ID signing of esbuild, successful app and DMG notarization, stapling and Gatekeeper, final resource paths/executable permissions, both architecture downloads, and cask installation/upgrade/removal on fresh machines. GUI runtime discovery and notifications remain native user acceptance, not consequences of a successful signature.

Configure environments, repositories and credentials per Contributing before tagging. Test an alpha tag first, then a new stable version for Homebrew. macOS 13 is an intentional release floor, not a claim of tested macOS 13 behavior.
