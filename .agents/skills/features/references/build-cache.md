# Build cache implementation reference

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical record](history/feature-records.md#build-cache) retains prior execution records.

## Specification and acceptance criteria

Copilot runtime assets are staged checkout-locally by `build.rs` through
`scripts/prepare-copilot.mjs`: pinned SDK, bridge/configuration modules and required dependencies,
including eager koffi native imports, **without optional Copilot CLI runtimes**.
Staging currently requires a native same-platform/architecture build and fails
instead of packaging a host binary for a different target. Native files receive
macOS signatures and the bundle verifier checks their signatures/resources.
No SDK build/staging/signature verification occurred in this task. See
[SDK runtime evidence](copilot-sdk.md#distribution-and-native-ownership).

Explicitly requested builds use checkout-local targets and publish verified whole artifacts to the primary CLI destination; no automatic packaging, branch changes or app launch. Compiler-cache reuse must never depend on shared target directories.

## Code map and invariants

- `scripts/build-app.mjs`: selects macOS app packaging/signature verification or a Linux native `--no-bundle` build, then stages the configured resource mappings and native esbuild helper beside the Linux executable. Linux local builds produce no installer.
- `mise.toml`: pins `aqua:mozilla/sccache` at 0.18.0 alongside Rust/Node;
  project-scoped `RUSTC_WRAPPER=sccache`, `CARGO_INCREMENTAL=0` apply to dev,
  check, test, build and `mise exec` Cargo commands.
- No `CARGO_TARGET_DIR`, `SCCACHE_DIR`, remote backend, global Cargo config,
  global mise config or shell startup edits. Use sccache's normal machine-local
  disk cache and preserve personal overrides. Default size is 10 GiB.
- Compilation targets and frontend output remain checkout-local. Never redirect
  a worktree's `CARGO_TARGET_DIR` into the primary checkout. App publication is a
  separate, explicitly requested step described below.
- Mise merges ancestor configs: once main has this configuration, existing and new
  worktrees nested under `.worktrees/` inherit the wrapper, incremental setting and
  tool pin without changing their tracked files. Explicit child overrides can
  supersede them. External worktrees need the configuration in their own branch.
  Tool installation alone does not enable the wrapper outside this config hierarchy.
- Developer guide: [Contributing](../../../../CONTRIBUTING.md#app-builds). Signed GitHub/Homebrew distribution is a separate [release pipeline](releases.md); local `mise run build` retains ad-hoc signing and does not publish remotely.

## Explicit build and publication workflow

- Never automatically run `mise run build`, Tauri packaging, or an equivalent app
  build for validation, task completion or merge/cleanup. Repository `AGENTS.md` owns
  required validation and fix workflow. All other tests, checks and builds require
  an explicit request; report what was not run.
  The user schedules builds across concurrent worktrees/agents to avoid CPU contention.
- “Build the app” includes publication to the primary checkout on `main` so the
  installed `nimrod` CLI uses the result. Before merge, compile the requested task
  worktree's source with its own target; after merge, build from `main` when asked.
  Do not merge/change source branches merely to build or publish.
- Locate the primary checkout using `git worktree list` (not `git rev-parse
  --show-toplevel`, which returns the task worktree). The installed launcher symlink
  resolves to that checkout; do not reinstall/repoint it to a disposable worktree.
- `mise run build` currently packages and verifies only the current checkout's
  artifact; it does **not** publish automatically. For a requested worktree build,
  stage the finished artifact beside the primary destination and replace the old
  artifact as a unit; do not patch/sign individual files in a running bundle.
  macOS: copy the complete `Nimrod.app` from the worktree's
  `src-tauri/target/release/bundle/macos/` into the same relative location in main,
  preserving bundle metadata/resources (for example with `ditto` into staging).
  Linux: publish the executable, adjacent `esbuild`, `resources/`, `bin/` and license/notice files to main’s `src-tauri/target/release/`, preserving executable permissions. These resources belong to the same build. Honor an explicit alternate artifact destination instead.
- Verify the published artifact matches the build; on macOS run
  `npm run verify:bundle -- /absolute/path/to/main/src-tauri/target/release/bundle/macos/Nimrod.app`.
  Report the source branch and published path. Never claim a worktree-only package
  is complete fulfillment of “build the app” unless the user requested isolation.
- The explicit build request authorizes replacing the default artifact, even before
  merge; the user accepts that requested builds can overwrite each other's output.
  No extra publication approval is needed. It does not authorize launching, quitting
  or restarting the app. An older running process keeps its old code until the user
  restarts it. Linux build/publication evidence is recorded in [verification](verification.md); native execution remains unverified;
  Windows remains a possible future target with no current CLI wrapper.

## Performance-report build identity

`src-tauri/build.rs` records the local checkout's Git revision, dirty/unknown flag and build-script timestamp for native [performance reports](performance-diagnostics.md). It resolves per-worktree HEAD/index/shared refs and watches frontend/native source plus checkout-local `dist` so a changed source/build identity is not silently reused. Git-unavailable builds explicitly record unknown identity; no repository paths or raw status output enter reports. Revision + dirty flag + build time distinguishes builds but is not a dirty-tree content fingerprint, nor proof that a dev server serves matching frontend source. This metadata does not authorize builds/checks or alter publication/cache isolation.

## macOS material helper

`src-tauri/build.rs` compiles `src/macos_blur.m` with the existing `cc` toolchain dependency, ARC and blocks only for macOS. The helper uses AppKit/QuartzCore and catches private material/filter Objective-C exceptions before the Rust boundary. Its object/library output stays in the checkout-local Cargo target; no compiler-cache or signing policy changes. The standalone blur probe links this same source for native validation, separately from app packaging.

## Personal plugin compiler asset

`src-tauri/build.rs` stages a target-matching native esbuild executable and license from already-installed npm dependencies. It is a Tauri `externalBin` sidecar, not a Node backend. Cargo check/test may prepare this ignored asset; that is dependency staging, not app packaging. No runtime downloads or package installation. Cross compilation requires the matching target esbuild dependency installed locally; wrong-target helpers fail staging.

Requested app bundles include/sign the sidecar. The macOS bundle verifier checks `Contents/MacOS/esbuild` before the whole app. Linux publication now requires both `nimrod` and its adjacent `esbuild` companion from the same build (and applicable notices); copying only the main executable is incomplete. Linux local executable/resource staging is implemented; installer packaging, helper execution and possible Windows packaging remain unverified. The separate runtime bundle cache is owned by [card plugins](card-plugins.md#native-compilercache-stage-e), not sccache.

## Cache boundaries / pitfalls

Compatible registry dependencies use the same source directory under Cargo home
and can hit across checkout-local target directories. Source, compiler, feature,
flag and profile changes invalidate incompatible entries. Cargo's existing download
cache is separate from this compiler cache. Existing target artifacts are not
imported retroactively.

Rust incremental compilation is not cacheable: disabling it trades within-checkout
incremental speed for cross-checkout compiler caching. Executables, proc macros,
dynamic libraries and final linking are not cached. Metadata-only checks and
Clippy may bypass caching. Build scripts run normally and can vary downstream flags.

Do not promise identical checkout-local crate cache hits. In sccache 0.18.0,
Rust hash computation includes the compilation cwd and Cargo environment paths.
`SCCACHE_BASEDIRS` normalization applies to C/C++ hashing, not this Rust hashing;
a two-root identical local-library fixture still missed. Do not add remapping flags
or normalize Cargo's manifest env by stripping paths: that can break source lookup,
`env!` consumers, debugging and build scripts. The expensive shared dependency
compilations are the intended reuse boundary.

Personal sccache config/env can select a different backend. This change does not
configure remote caching or modify that personal configuration. sccache uses a
local daemon; its stats are cumulative for its lifetime, and some settings only
change after a server restart. Do not stop a pre-existing user's server just to
reset counters. Cache entries survive a restart.

## Tests and remaining acceptance

Offline two-root fixtures established compatible shared dependency reuse in both directions on macOS. Source-local crates and final linking need not hit. Linux/possible Windows cache behavior remains unverified. Historical setup evidence is in [build history](history/feature-records.md#build-cache).
