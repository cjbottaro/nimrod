# Release distribution

**Status: implemented, not executed against Apple/GitHub/Homebrew.** This is a macOS release pipeline, not cross-platform acceptance. Local builds retain ad-hoc signing. User instructions: [Installation](../../../../docs/installation.md). Operator setup: [Contributing](../../../../CONTRIBUTING.md#release-setup).

## Development and changelog policy

### Local development is not release preparation

- Preserve the current loop: dedicated task worktree → commit → merge into main → mandatory `cargo check` on main (fix and repeat until passing) → explicitly requested local build. Follow the [worktree workflow](../../../../CONTRIBUTING.md#worktree-workflow) for the exact command and task-worktree fix loop. Frequent merges and personal builds are expected; neither requires a version bump, tag, changelog rollover or release ceremony.
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

### Implemented publication behavior

The metadata/preflight command validates notes before builds start; publication re-extracts them from the pinned tagged checkout. Stable releases require exactly one matching `## VERSION — YYYY-MM-DD` section with a real calendar date. Prereleases require nonempty Unreleased notes. Unreleased must appear once as the first level-two section. Empty/category-only/comment-only target sections, duplicates and unterminated fences/comments fail closed. Fenced heading examples are not section boundaries; author HTML comments outside code fences are omitted. The extractor neither edits the changelog nor rolls over Unreleased.

Publication writes the extracted body to `release-notes.md`, passes it with `gh --notes-file`, and uploads that exact file as an asset. No generated commit/PR-note fallback remains. Draft retries refresh the body from the same source; already-public retries must match both the existing GitHub body (normalized line endings/outer whitespace) and every expected asset byte. Public notes/assets are never rewritten by a retry.

The macOS release workflow, verifier, artifact names/checksums and Homebrew cask target **Apple Silicon only** (`aarch64-apple-darwin`, ARM64). The cask has an explicit ARM64 dependency and a fixed ARM download URL. This does not alter source/local-build targets, narrow the Linux roadmap or claim Linux acceptance. No tag, version bump, workflow dispatch or release is performed by implementing this behavior.

## Agent release preview and approval

The dedicated [release skill](../../release/SKILL.md) is the entry point for requests to generate, prepare, cut, ship, publish or retry a release. The initial request authorizes a local read-only proposal, not execution. This preview gate overrides ordinary task commit/merge preauthorization for release version/changelog preparation. It is an agent workflow contract, not a GitHub Actions enforcement mechanism: a directly pushed version tag can still trigger the workflow.

Before release metadata changes or publication, the agent must present the proposed version/tag, stable/prerelease channel, exact source base and included scope, complete proposed changelog/release-note body, stable date/rollover or prerelease snapshot plan, exact version-file changes, actual workflow platforms/artifacts, destination repository/title, Homebrew/tap effect, validation evidence tied to revisions, hard blockers and unverified prerequisites. Unknown remote state and unrun validation must be labeled, never guessed. Local development remains independent of release preparation.

The preview must enumerate requested permissions: local preparation commit/merge; any separately requested local checks/builds; exact remote/ref pushes or an explicitly chosen retry/dispatch; and the resulting remote CI signing/notarization, public GitHub release and stable Homebrew update. Stop and await a subsequent explicit affirmative response to the concrete publication question. A generic initial “publish a release” request, agreement with notes alone, silence or ambiguous acknowledgement does not bypass review. Preparation-only approval stops before tags, pushes or remote actions. Permission to inspect remote state or validate is not permission to publish.

Approval applies only to that source base plus the disclosed metadata-only preparation diff, version/channel, notes/date, platform/artifact scope and destination/action set. New feature commits, main drift, modified notes/version/workflow/platforms or expanded remote actions require a fresh preview and approval. Do not silently include newer main changes or inherit assumed approval from another session. Recheck the final preparation diff/commit before creating/pushing the tag; preserve unrelated changes and stop on conflicts.

Publication approval can authorize the remote checks/build/signing pipeline when disclosed; it does not automatically authorize local packaging, user-app interruption, repository/credential administration, bypassing protection, force pushes, tag moves, deleting releases/assets or worktree cleanup. Inspect remote prerequisites only within explicit authorization. Known validation failures must be resolved, not hidden; unrun local checks are not passes, and CI checks cannot be skipped. Revalidate newly discovered blockers before proceeding.

After execution, report the exact version/tag/commit and actual workflow, GitHub release and tap state. A successful tag push is not a completed release. Verify ambiguous acceptance before retrying and apply the immutable-publication/recovery contract below. Never rebuild/overwrite public assets to resolve a retry, or claim pending signing/platform acceptance as complete.

## Contract

- Version tags `vMAJOR.MINOR.PATCH` create stable releases; valid SemVer prerelease suffixes create GitHub prereleases only. Build metadata suffixes are deliberately unsupported.
- The tag must match package.json, package-lock.json (top-level and root package), Tauri config, Cargo.toml and the Nimrod Cargo.lock package. The tagged commit must be reachable from main. Every downstream checkout uses the prepare job's resolved commit, not a moving branch/tag; publication rechecks the remote tag's resolved commit before mutation.
- All releases are serialized by a workflow-wide concurrency group. One native Apple Silicon job uses `macos-15` and target-native esbuild. The release macOS deployment floor is 13.0; Intel release artifacts are not built or required.
- Offline checks/fixture tests precede credential import. No Pi installation, provider request, user session, or native app launch is needed by the workflow.
- The app and compiler sidecar must have whole Developer ID signatures, the expected Team ID and hardened runtime; architecture checks cover both executables. The packaged Bash launcher must match source.
- Tauri notarizes/staples the app before DMG creation. The DMG is additionally submitted to notarytool and stapled explicitly. Stapler/Gatekeeper verification must succeed before artifact upload.
- Checksums and the Homebrew cask are generated from the final stapled DMG bytes, not intermediate files. The ARM app/helper signatures, architecture, notarization and Gatekeeper verification must pass before publication.
- Releases are assembled as drafts, uploaded, then made public. An upload/API failure cannot publish an incomplete new release. Draft retries may replace assets. Published notes and assets are immutable: retries must match the GitHub body and download/byte-compare every expected asset, including `release-notes.md`, before treating publication as already complete; fresh builds cannot silently replace signatures/checksums.
- Stable versions cannot move backwards relative to existing stable GitHub releases or the current cask. Same-version cask retries must be byte-identical. Prereleases never update the cask or take GitHub's latest stable slot.
- A tap failure does not roll back a public release. Re-run failed jobs with retained original artifacts; do not rebuild/re-sign a published version. Action artifacts expire after seven days; the published stable release also includes the exact `nimrod.rb` for manual recovery.
- Stable runs require a public Nimrod repository/releases for unauthenticated downloads. Homebrew uses a dedicated public tap, not homebrew/cask. Only `Casks/nimrod.rb` is committed, without force push. No quarantine bypass, custom install hooks, automatic runtime installation or uninstall data purge.
- Apple secrets are available only in the build job's named steps. Release write permission is limited to publication; the tap uses a separate repository-scoped token/environment. Each build imports a temporary keychain and raw .p8 into RUNNER_TEMP and deletes them in an always cleanup step. Signing setup refuses to run outside a GitHub macOS runner.
- Merely editing this pipeline does not authorize pushing tags, creating repositories/secrets, notarizing builds or publishing remotely.

## Code map

- `.agents/skills/release/SKILL.md`: discoverable operational workflow with local preview, scoped explicit approval, drift checks, approved execution and accurate outcome reporting. No publishing command is executed by merely loading the skill.
- `.github/workflows/release.yml`: tag/manual triggers, tag/version/changelog preflight, pinned source identity, one native ARM build, publication, stable tap update.
- `src-tauri/tauri.release.conf.json`: release-only DMG/app targets, null signing identity removes the local ad-hoc override so APPLE_SIGNING_IDENTITY applies, hardened runtime and deployment floor.
- `scripts/prepare-release-signing.sh`: environment preflight, temporary certificate/private-key setup.
- `scripts/verify-release-macos.sh`: fixed ARM target; app/helper signatures, ARM-only architecture and launcher verification, final DMG notarization/stapling/Gatekeeper checks without app execution.
- `scripts/release.mjs`: safe version/repository parsing, fence/comment-aware changelog extraction, normalized ARM asset names, final checksums/notes/cask generation, draft/publication and immutable body/asset retry/upgrade guards. Cargo.toml extraction reads the entire `[package]` table through the next table header or file end; only the subsequent version-line match uses multiline anchoring. A multiline `$` in the table boundary would incorrectly stop after the first field. Uses only Node built-ins and gh; no npm installation for metadata/publication jobs.
- `src-tauri/tauri.conf.json`: explicit resource map packages `bin/nimrod` at `Contents/Resources/bin/nimrod` and notices at the resource root while preserving the runtime extension/compiler-license paths.
- `bin/nimrod`: resolves Homebrew symlinks to its own containing bundle; source-checkout behavior and NIMROD_APP priority remain unchanged. Native launch routing stays owned by [single-instance startup](single-instance.md).
- `test/release.test.mjs`: built-in Node fixture tests for tag/version/changelog preflight, stable/prerelease section selection, date/duplicate/empty/fence/comment handling, ARM-only workflow/verifier/cask/artifacts, notes-file publication and immutable body/asset retries, plus downgrade and draft failure guards; gh is injected and never called live. Metadata CLI subprocesses use only disposable fake version/changelog files and never publish. Cargo version fixtures cover multiline/blank-line package fields, LF/CRLF, package tables following other tables or ending at EOF, and rejection of missing versions rather than borrowing dependency/metadata versions.
- `test/cli-launcher.test.ts`: intercepted shell fixture includes a Homebrew-style relative symlink into a moved bundle and override precedence.

## Verification boundaries

The user reports main passes `mise run check` before this change. No checks, tests or builds were run for the ARM/changelog implementation; its new/updated fixtures remain unexecuted. No signed builds or remote release runs have been executed. First-run acceptance must establish runner/tool availability, imported Developer ID signing of esbuild, successful app and DMG notarization, stapling and Gatekeeper, final resource paths/executable permissions, ARM downloads, stable/prerelease GitHub notes and cask installation/upgrade/removal on fresh machines. GUI runtime discovery and notifications remain native user acceptance, not consequences of a successful signature.

Configure environments, repositories and credentials per Contributing before tagging. Test an alpha tag first, then a new stable version for Homebrew. macOS 13 is an intentional release floor, not a claim of tested macOS 13 behavior.
