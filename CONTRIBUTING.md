# Contributing

## Local setup

Use the pinned mise toolchain; Rust is installed through mise, not Homebrew:

```sh
mise trust
mise install
npm ci
mise run dev
```

macOS needs Xcode Command Line Tools. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Linux or possible Windows development. Keep the JS/Rust Tauri packages on compatible major/minor versions and update both lockfiles deliberately.

### Copilot SDK runtime

Built-in Copilot pins `@github/copilot-sdk@1.0.22`, whose released metadata names
CLI 1.0.98. Install/authenticate that CLI separately and set
`runtime.copilotPath` if discovery fails. Node must satisfy
`^20.19.0 || >=22.12.0`; mise's 25.9.0 does. Users never install the SDK.
The bridge explicitly passes the resolved CLI path to
`RuntimeConnection.forStdio`, so it cannot fall back to SDK-bundled CLI packages.

After `npm ci`, native Cargo asset preparation runs `scripts/prepare-copilot.mjs`
to stage the bridge, SDK dist, zod/vscode-jsonrpc and koffi with its platform
native package. The SDK eagerly imports koffi even with stdio. Do not omit
optional dependencies from installation: the native koffi package is required.
Only those runtime dependencies ship; optional `@github/copilot-*` CLI binaries
are deliberately excluded. Staging retains dependency licenses and signs native
files for requested macOS builds; the bundle verifier checks resources/signatures.
Generated resources stay checkout-local/ignored. No build or staging was run for
this migration. Native macOS/Linux SDK acceptance remains pending; Windows
SDK execution is unavailable until owned process-tree teardown exists.
See [SDK implementation](.agents/skills/features/references/copilot-sdk.md).

## Worktree workflow

Work on a dedicated branch/worktree under `.worktrees/`, never directly on `main`. After completing significant work, commit it on the task branch and merge into `main` without a separate approval step. After every worktree merge, run `mise exec -- cargo check --manifest-path src-tauri/Cargo.toml` from the primary checkout on `main`. Fix any reported compilation errors in a dedicated task worktree, commit and merge the fixes, and rerun on `main` until it passes. Never fix directly on `main`; report blockers if a safe fix is unavailable. Other tests, checks and builds remain request-only. Preserve unrelated changes and report merge blockers rather than forcing or discarding work. Do not push without permission. Retain the task branch and worktree after merging; remove them only when explicitly requested. “Cleanup” after merging means removing the task's worktree with `git worktree remove` and deleting its local branch with `git branch -d`. First confirm the branch is merged into `main` and the worktree has no uncommitted changes; never force removal or branch deletion, or discard unmerged or uncommitted work.

Keep compiler targets, `node_modules/` and frontend output checkout-local; do not redirect Cargo targets into another checkout. Mise's shared machine-local sccache reuses compatible Rust dependency compilations; final linking and all checks are not necessarily cacheable. Inspect it with `mise exec -- sccache --show-stats`.

## Changelog and local development

Keep the rapid local loop unchanged: task worktree → commit → merge into main → cargo check on main (fix and repeat until passing) → build when explicitly requested. Local builds and frequent merges need **no version bump, tag or release**. They may include changes beyond the latest public version; Git revision/dirty-state build metadata distinguishes those builds. Normal pushes to main do not publish releases.

Maintain the root [CHANGELOG.md](CHANGELOG.md) as changes merge. Add meaningful user-visible features, behavior changes, fixes, removals and compatibility/installation changes under **Unreleased**, in the same task commit as the implementation. Use nonempty **Added / Changed / Fixed / Removed** groups; mark breaking changes and include migration instructions. Skip internal refactors, test maintenance and routine documentation/policy edits unless they materially affect users; agents report when no entry is warranted.

Unreleased describes the current outcome, not every experiment. Consolidate related iterations while preserving other tasks' entries; remove reverted unreleased features rather than logging an add/remove cycle. Never silently rewrite published history or list unmerged/planned work. No historical versions/dates are fabricated when starting the changelog.

During deliberate stable-release preparation, move the reviewed Unreleased entries under `VERSION — YYYY-MM-DD` (UTC release date), leave a fresh Unreleased section, and commit this with the package version bump before tagging. Prereleases snapshot Unreleased from the tagged source without clearing it. The pipeline validates the selected section before building and publishes its contents as GitHub release notes and a `release-notes.md` asset. Missing, duplicated, invalid-date or empty target sections stop publication; there is no auto-generated commit-list fallback. Stable headings must use exactly `## VERSION — YYYY-MM-DD`, with a real calendar date; Unreleased must be the first level-two section and appear once. Markdown fences are respected and author HTML comments outside fences are omitted.

Packaged macOS releases and the Homebrew cask are Apple Silicon only; no Intel artifact is built or required. This does not change the Linux roadmap or local build targets. Full agent rules and implementation boundaries are in the [release policy](.agents/skills/features/references/releases.md#development-and-changelog-policy).

## Checks

After every worktree merge, the required fast Rust feedback loop runs from the primary checkout on `main`:

```sh
mise exec -- cargo check --manifest-path src-tauri/Cargo.toml
```

Resolve compilation errors through the worktree workflow above and rerun until passing. This checks Rust without producing the final app binary; it does not execute tests or establish packaging/native acceptance. Cargo build scripts may stage ignored checkout-local dependencies.

All other checks and tests run only when explicitly requested:

```sh
mise run check
npm run check:docs

# Include when validation of scrolling changes is requested; offline demo fixture only:
npx playwright install webkit  # one-time setup
npm run test:browser
```

The standard check includes local Markdown links/anchors, TypeScript/UI tests, Rust formatting, Clippy and fixture tests. Tests must not call paid models, compact live conversations, delete user sessions or modify upstream Pi/the sibling pi-gui extension. Automated browser tests are allowed; interactive browser debugging and launching/interrupting the user's app require approval.

Optional installed-Pi metadata smoke tests use disposable config/session directories and hand-authored history, with user resources disabled. They send no prompts:

```sh
NIMROD_TEST_PI="$(command -v pi)" mise exec -- cargo test \
  --manifest-path src-tauri/Cargo.toml local_pi_ -- --ignored
```

Fixture evidence is not native/platform acceptance. Record native observations separately.

## App builds

Do not automatically build/package for validation, task completion or merge/cleanup. Run only on an explicit app-build request:

```sh
mise run build
```

This packages and verifies the current checkout. An agent-directed **build the app** request also includes staging and publishing the finished artifact to the primary checkout's CLI-visible default location. Before merge, build the task worktree's source with its own targets; after merge, build main when asked. Completed significant work is merged under the worktree workflow above, independently of builds. A build request does not authorize launching/quitting/restarting the user's app.

- macOS: `src-tauri/target/release/bundle/macos/Nimrod.app`
- Linux: `src-tauri/target/release/nimrod`, with the same-build `esbuild` sidecar beside it.

Keep the installed CLI pointing to the primary checkout. Requested publications may overwrite one another; the user coordinates builds. For staging, signature verification and cache pitfalls, follow the [internal build workflow](.agents/skills/features/references/build-cache.md).

Cargo asset preparation copies a target-matching esbuild binary/license from the installed npm dependency into an ignored staging directory; Tauri packages it as a compiler sidecar. No compiler is downloaded at runtime. Native same-platform builds use `npm ci`; cross builds require the matching target dependency installed locally. Requested macOS verification includes the helper signature. Compiler packaging/execution still needs native acceptance; no app build is part of checks.

## Release setup

The [Release workflow](.github/workflows/release.yml) builds Developer ID signed/notarized macOS 13+ DMGs for Apple Silicon only. It publishes GitHub Releases and updates a stable Homebrew cask in a separate tap. Local `mise run build` remains ad-hoc signed; the release overlay is `src-tauri/tauri.release.conf.json`. No updater service or App Store submission is involved.

### Apple credentials

1. Enroll in the Apple Developer Program. Create a **Developer ID Application** certificate using a CSR from Keychain Access; install it with its private key on your Mac. An Apple Development or Apple Distribution certificate is not the right identity.
2. Export that certificate **with its private key** as a password-protected `.p12`. Base64-encode it for the secret below (`openssl base64 -A -in /path/to/certificate.p12`). Keep exports outside the repository.
3. Create an **App Store Connect team API key** with Developer access under Users and Access → Integrations. API access may first need the account holder's approval. Download its `.p8` once; retain the issuer UUID and Key ID. This workflow uses a team issuer/key, not an issuer-less individual API key or your Apple login password.
4. Create a GitHub environment named **release** in this repository and set:

| Environment secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the exported `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The export password |
| `APPLE_SIGNING_IDENTITY` | Full `Developer ID Application: Your Name (TEAMID)` identity; inspect with `security find-identity -v -p codesigning` |
| `APPLE_TEAM_ID` | The Apple team identifier expected in signatures |
| `APPLE_API_KEY` | App Store Connect Key ID, not the key contents |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |
| `APPLE_API_KEY_P8` | Raw multiline contents of the `.p8` private key |

The workflow imports the certificate into a temporary runner keychain, writes the API key under RUNNER_TEMP, and removes both in an always cleanup step. Only the signed assets leave the build jobs. Keep signing access on trusted version tags/manual runs; environment tag restrictions must allow `v*`, plus `main` if using manual dispatch from main. Configure required approvals if desired. Protect release tag creation in repository rules.

See [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/) and [Apple Developer ID](https://developer.apple.com/developer-id/).

### Homebrew tap

1. The Nimrod repository/releases must be **public** for unauthenticated Homebrew downloads; stable runs reject a private source repository. Create a **public** GitHub repository `cjbottaro/homebrew-tap`, initialized with a README and a `main` branch. The first stable run creates `Casks/nimrod.rb`. This is your own tap, not a submission to Homebrew's central cask repository.
2. Create a fine-grained token scoped **only** to that tap with **Contents: Read and write**. It needs to check out and push `Casks/nimrod.rb`; the app repository's default GITHUB_TOKEN cannot write another repository.
3. Create a GitHub environment **homebrew** in the Nimrod repository; add `HOMEBREW_TAP_TOKEN` as its secret. For another owner/repository, set `HOMEBREW_TAP_REPOSITORY` as a GitHub Actions configuration variable in that environment. The default is `cjbottaro/homebrew-tap`. Adjust the documented install command for another tap.
4. Allow this bot's normal non-force commits to the tap's main branch under your branch rules. If direct writes are not allowed, the workflow will fail rather than bypass protection; adapt to a PR-based tap workflow instead.

The generated cask requires ARM64, uses the final Apple Silicon DMG's checksum, installs the app and links its packaged `nimrod` launcher. It does not install Node/Pi, bypass quarantine or purge user data on uninstall. No private token is needed by end users.

### Agent-assisted releases

Invoke **`/skill:release`**, optionally with a version/channel such as `/skill:release prepare v0.1.0-alpha.1`, or ask the agent to **prepare a release**, **generate a release**, or **prepare an alpha release**. The dedicated [release skill](.agents/skills/release/SKILL.md) is named `release` and is discovered from `.agents/skills/release/`; existing sessions may need a supported reload/restart or a new session to discover it. Nimrod does not implement Pi's `/reload`. The skill first inspects local state and shows a proposal; even an initial “publish a release” request or command arguments do not bypass this preview.

The preview includes the proposed version/tag and channel, source commit/scope, complete exact release notes, changelog/date and version-file plan, supported platforms/artifacts, GitHub destination, whether Homebrew updates, validation results and outstanding blockers/unknowns. It also lists the actions requiring permission, including any pushes and the resulting remote build/signing/publication. Release metadata changes, tags and publication wait for approval of that concrete preview. Remote inspection and checks/builds require separate explicit authorization; the default preview is local and read-only.

The agent then **stops for explicit approval**. An affirmative answer to its specific publication question authorizes only that preview's disclosed scope; approval of the notes alone does not authorize publishing. You can request preparation only, with no tag or push. If source, notes, version, platforms or other material inputs change, the agent must preview again. Expected metadata-only preparation edits are included in the original preview, so their new commit ID alone does not require another review.

This is an agent instruction, not a new GitHub workflow gate. Direct tag pushes still trigger the pipeline, and any separately configured GitHub environment approvals still apply. The agent must distinguish a queued workflow from a finished release and report GitHub and Homebrew outcomes separately. This workflow never turns routine local builds into releases.

### Cut a release manually

Follow [changelog and local-development policy](#changelog-and-local-development): release preparation is deliberate, not part of routine personal builds. Review the matching changelog section or prerelease snapshot along with the version bump. Release changes must already be merged into main. Set **all** version locations to the exact version, including a prerelease suffix if applicable:

- `package.json` and `package-lock.json` (top-level and `packages[""].version`); `npm version VERSION --no-git-tag-version` updates these without making a commit/tag.
- `src-tauri/tauri.conf.json`.
- `[package].version` in `src-tauri/Cargo.toml` and the `nimrod` package's version in `src-tauri/Cargo.lock` (not every dependency version).

Commit/merge that version change using the worktree workflow, then tag the resulting main commit when ready to publish:

```sh
git tag -a v0.1.0 -m 'Nimrod 0.1.0'
git push origin main
git push origin v0.1.0
```

Those pushes trigger remote builds and publication. They are explicit operator actions; an agent may perform them only after the [release preview and publication approval](#agent-assisted-releases), never as part of ordinary local implementation. A manual **Actions → Release → Run workflow** also accepts an existing tag; dispatch from main. The tag must resolve to a commit reachable from main, and its version must match all package identities. Publication rechecks that the remote tag still resolves to the prepared source commit. Do not move published tags.

The pipeline validates the tag's changelog notes, runs offline checks, then signs/notarizes/verifies the Apple Silicon app and its compiler sidecar. It additionally notarizes/staples the final DMG, generates `SHA256SUMS` from its final bytes, creates/uploads a draft release with the reviewed changelog body, and publishes only after verification passes. The body is also retained as `release-notes.md`; draft retries refresh it from the same tagged source, while public retries must match the existing notes and assets rather than rewriting them. Stable releases include the generated `nimrod.rb` and update the tap. Prereleases such as `v0.2.0-alpha.1` publish to GitHub only and do not replace the latest stable release.

Start with an alpha version to exercise signing/downloads without changing Homebrew; then increment to a stable version to exercise tap publication. Native acceptance should include browser downloads on another Apple Silicon Mac, first launch, Pi discovery, notifications, `brew install`/upgrade/uninstall, and `nimrod .`. Pipeline signing success is not GUI/platform acceptance. Add the actually tested Pi version and known limitations to the selected changelog section before tagging; the pipeline does not infer runtime compatibility.

### Failure and retry

A build failure publishes nothing. Upload failure leaves a draft that can be retried. A tap failure leaves the GitHub release published: use **Re-run failed jobs**, preserving the original artifacts, rather than rebuilding/re-signing that tag. Publication retries of an already-public release must byte-match every published asset and never replace it; stable publication/tap checks reject downgrades. Artifacts are retained for seven days. After that, recover `nimrod.rb` from the public stable release and update the tap manually, or publish a new version. If a first release fails midway, inspect/delete only that release's draft explicitly before starting over; do not delete public assets to bypass immutability.

**Verification:** the Apple Silicon/changelog changes and their new fixtures have not been run. Apple credentials, actual notarization and fresh-machine/Homebrew installation still need first-run acceptance. [Internal release contract](.agents/skills/features/references/releases.md).

## Maintained external card plugins

`plugins/` holds real optional external renderer sources, not production imports. They are type-checked with the app and exercised through synthetic/offline fixtures. [Pi Web Access cards](docs/pi-web-access-plugin.md) documents the first plugin's compatibility, limitations and personal installation. Keep its source self-contained except for type-only SDK imports so a regular copy works without installing dependencies or altering upstream Pi extensions.

## Card plugin examples

The supported type-only SDK is `src/card-plugin-api.ts`; it has no runtime dependencies and may be copied into a separate plugin project. API usage/ownership is documented in [Authoring card plugins](docs/card-plugin-api.md). The example is included in normal TypeScript checking.

Personal source installation needs no manual compiler step: copy `examples/card-plugins/command-summary/plugin.ts` as `command-summary.ts` or `command-summary/index.ts` into your personal `card-plugins/` directory. Metadata is in the TS export. Nimrod compiles/caches it automatically on startup/reload. This is trusted browser code, not a Pi/Node extension.

For an optional legacy/distribution manifest, compile the self-contained browser ESM explicitly (this is not an app build):

```sh
npx esbuild examples/card-plugins/command-summary/plugin.ts \
  --bundle --platform=browser --format=esm --target=es2022 \
  --outfile=src-tauri/target/card-plugin-examples/command-summary.js
```

Copy the compiled `command-summary.js` and `examples/card-plugins/command-summary/plugin.json` (named `command-summary.json`) into your config-adjacent `card-plugins/` directory, then configure explicit enablement/trust as described in [Card plugins](docs/card-plugins.md#existing-manifest-packages). These are manual development/install steps; tests compile only disposable/in-memory fixture modules and never write the user's config or trust settings.

## Documentation ownership

- `README.md`: product introduction, first use and feature links.
- `docs/`: user-facing features, usage, observable behavior and relevant limitations.
- `.agents/skills/features/references/`: specifications, acceptance criteria, implementation, storage, invariants and platform pitfalls.
- [UI vocabulary](.agents/skills/nimrod-ui-vocabulary/SKILL.md): canonical terms, not duplicate specifications.
- [Verification status](.agents/skills/features/references/verification.md): current evidence boundaries and remaining acceptance.
- Internal `references/history/`: historical execution records, never current requirements.

Use the [features index](.agents/skills/features/SKILL.md) to find the canonical owner of a contract. Behavior changes update both the specification and relevant user guide. Implementation-only changes update internal references; developer tooling changes update this guide and their internal reference. Do not add a skill per feature.

Catalog maintenance is explicit and separate from app builds; see the [theme-catalog procedure](.agents/skills/features/references/theme-catalog.md).
