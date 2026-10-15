# Release distribution

**Status: implemented, not executed against Apple/GitHub/Homebrew.** This is a macOS release pipeline, not cross-platform acceptance. Local builds retain ad-hoc signing. User instructions: [Installation](../../../../docs/installation.md). Operator setup: [Contributing](../../../../CONTRIBUTING.md#release-setup).

## Development and changelog policy

### Local development is not release preparation

- Preserve the current loop: dedicated task worktree → commit → merge into main → explicitly requested local build. Frequent merges and personal builds are expected; neither requires a version bump, tag, changelog rollover or release ceremony.
- Local main can contain Unreleased changes beyond the latest public version. Retain the configured package version until deliberate release preparation; existing Git revision/dirty-state build metadata distinguishes local builds without manufacturing versions.
- A normal main push does not publish; a pushed version tag triggers the release workflow. Manual dispatch is also an explicit remote publication action, not a local build step. Follow existing authorization boundaries; never create/push release tags or publish just because a feature was completed.

### Task completion and entries

- The root `CHANGELOG.md` is the single maintained user-facing release history. Keep `## Unreleased` first, followed by released versions newest first. Create only nonempty `### Added`, `### Changed`, `### Fixed` and `### Removed` groups, in that order.
- Every task must assess user-visible impact. Include meaningful implemented features, behavior changes, noticeable fixes, removals, compatibility and installation changes. Update Unreleased in the same task commit as the implementation. If no entry is warranted, state that and the reason in the completion report.
- Exclude internal refactors, implementation details, test maintenance and routine documentation/policy changes unless they materially affect users. Do not copy commit subjects, agent progress, intermediate failed approaches, verification logs, planned work or promises into the changelog. Describe the outcome using product terminology; preserve actual verification limitations.
- Prefix breaking changes with **Breaking:** and include the concrete migration/action required. Choose the category based on the user-visible outcome, not the internal type of edit.
- Unreleased is editable while behavior evolves: revise or consolidate the same feature's iterations into one accurate final description. If an unreleased feature is reverted entirely, remove its entry rather than documenting an add/remove cycle that no public user experienced.
- Preserve unrelated entries from concurrent worktrees. Resolve merges by retaining distinct changes and consolidating only overlapping descriptions; never replace the whole section with one task's view. Keep entries for work actually present on the target branch, not unmerged worktrees.
- Published sections are historical. Put subsequent changes in Unreleased; do not silently rewrite old notes. Explicit factual corrections are exceptional and must not alter what that version actually shipped.
- Start the file with Unreleased; do not invent prior versions or dates. Before the first public release, deliberately curate its initial feature summary from the tagged source rather than backfilling every development commit.

### Deliberate release preparation

- Select a release version deliberately, not per task or local build. Follow SemVer: breaking changes require an appropriate compatibility bump, additions a minor bump and fixes a patch bump; pre-1.0 compatibility/version choices remain explicit operator decisions. Keep all npm/Cargo/Tauri version identities aligned as required below.
- Stable release: move the reviewed Unreleased entries into `## VERSION — YYYY-MM-DD` using the release's UTC date, leave a fresh Unreleased section, and commit the changelog rollover with the package version bump. Tag that merged preparation commit only when publication is requested. The changelog must describe only changes included in that tag.
- Prerelease: bump the package identities to the exact prerelease version, but do not roll over or clear Unreleased. GitHub prerelease notes snapshot Unreleased from the tagged source. Later development may refine Unreleased; it cannot change that published snapshot.
- Release notes should use the matching stable section or prerelease snapshot as the authoritative text, not auto-generated commit/PR lists. Stop release preparation if its notes/version are missing or inconsistent; do not substitute a guessed history. The same reviewed material can flow to GitHub without a second manually maintained changelog.

### Implementation boundary and agreed follow-ups

This policy is agent/operator guidance, not new runtime enforcement. The existing release script still uses GitHub `--generate-notes`; extracting the versioned changelog/prerelease snapshot and enforcing it in publication remains a follow-up. No tag, version bump, workflow dispatch or release is performed by a policy-only task.

The agreed macOS distribution direction is **Apple Silicon only**; this does not narrow the Linux roadmap or claim Linux acceptance. The current workflow/cask generator still supports Apple Silicon and Intel. Removing Intel artifacts and adapting verification, checksums/cask generation and documentation together is a separate implementation step; do not claim ARM-only publication until that change is made.

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
- `scripts/release.mjs`: safe version/repository parsing, normalized asset names, checksums/cask generation, draft/publication and immutable retry/upgrade guards. Cargo.toml extraction reads the entire `[package]` table through the next table header or file end; only the subsequent version-line match uses multiline anchoring. A multiline `$` in the table boundary would incorrectly stop after the first field. Uses only Node built-ins and gh; no npm installation for metadata/publication jobs.
- `src-tauri/tauri.conf.json`: explicit resource map packages `bin/nimrod` at `Contents/Resources/bin/nimrod` and notices at the resource root while preserving the runtime extension/compiler-license paths.
- `bin/nimrod`: resolves Homebrew symlinks to its own containing bundle; source-checkout behavior and NIMROD_APP priority remain unchanged. Native launch routing stays owned by [single-instance startup](single-instance.md).
- `test/release.test.mjs`: built-in Node fixture tests for tag/version validation, checksum/cask generation, downgrade guards, draft ordering/failure and immutable retries; gh is injected and never called live. Cargo version fixtures cover multiline/blank-line package fields, LF/CRLF, package tables following other tables or ending at EOF, and rejection of missing versions rather than borrowing dependency/metadata versions.
- `test/cli-launcher.test.ts`: intercepted shell fixture includes a Homebrew-style relative symlink into a moved bundle and override precedence.

## Verification boundaries

Local docs checks and TypeScript compilation passed, but full `mise run check` failed in JavaScript tests before reaching Rust checks. The Cargo version parser correction and additional regression fixtures have not been rerun. No signed builds or remote release runs have been executed. First-run acceptance must establish runner/tool availability, imported Developer ID signing of esbuild, successful app and DMG notarization, stapling and Gatekeeper, final resource paths/executable permissions, both architecture downloads, and cask installation/upgrade/removal on fresh machines. GUI runtime discovery and notifications remain native user acceptance, not consequences of a successful signature.

Configure environments, repositories and credentials per Contributing before tagging. Test an alpha tag first, then a new stable version for Homebrew. macOS 13 is an intentional release floor, not a claim of tested macOS 13 behavior.
