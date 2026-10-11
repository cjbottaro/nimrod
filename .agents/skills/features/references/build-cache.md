# Build cache implementation reference

## Code map and invariants

- `mise.toml`: pins `aqua:mozilla/sccache` at 0.18.0 alongside Rust/Node;
  project-scoped `RUSTC_WRAPPER=sccache`, `CARGO_INCREMENTAL=0` apply to dev,
  check, build and `mise exec` Cargo commands.
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
- User guide: `docs/build-cache.md`, linked from README and documentation index.

## Explicit build and publication workflow

- Never automatically run `mise run build`, Tauri packaging, or an equivalent app
  build for validation, task completion or merge/cleanup. Run `mise run check` and
  relevant offline tests; report app build as not run unless explicitly requested.
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
  Linux: publish the executable to main's `src-tauri/target/release/nimrod`, preserving
  executable permissions. Honor an explicit alternate artifact destination instead.
- Verify the published artifact matches the build; on macOS run
  `npm run verify:bundle -- /absolute/path/to/main/src-tauri/target/release/bundle/macos/Nimrod.app`.
  Report the source branch and published path. Never claim a worktree-only package
  is complete fulfillment of “build the app” unless the user requested isolation.
- The explicit build request authorizes replacing the default artifact, even before
  merge; the user accepts that requested builds can overwrite each other's output.
  No extra publication approval is needed. It does not authorize launching, quitting
  or restarting the app. An older running process keeps its old code until the user
  restarts it. Linux publication is intended behavior, not locally verified acceptance;
  Windows remains a possible future target with no current CLI wrapper.

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

## Verification

On macOS, installed the pinned Aqua binary through mise. Offline fixtures used two
separate Cargo roots (`main` and `.worktrees/branch`), separate targets, and one
shared dependency source directory, modeling Cargo's shared registry source cache.
Main-first compilation produced a dependency miss; branch compilation produced a
Rust cache hit. After editing only the fixture dependency, branch-first compilation
produced a miss and main compilation produced a hit. The second sequence also
verified disk cache use after restarting the server started by this task; no
pre-existing sccache executable/server was found before setup.

The fixture created no model/Pi calls or application windows and did not modify
main's artifacts. `CARGO_NET_OFFLINE=true mise run check` passed 341 TS/Node tests, formatting,
Clippy and 76 Rust tests (two opt-in real-Pi tests ignored).
`CARGO_NET_OFFLINE=true mise run build` passed packaging and macOS signature
verification for `.worktrees/shared-build-cache/src-tauri/target/release/bundle/macos/Nimrod.app`.
Both used the task worktree only; main's default/running bundle was untouched.
After merging into main, verified `mise exec -- printenv RUSTC_WRAPPER
CARGO_INCREMENTAL` and `mise exec -- sccache --version` in main and every existing
worktree (card-plugin-plan, keybinding-option-key, native-session-deletion,
resume-session-picker, session-terminology, shared-build-cache, sidebar-filters).
All resolved `sccache`, `0` and version 0.18.0. Existing in-progress worktree edits
were preserved; no child overrides, branch merges or app launches were needed.
Linux and Windows cache behavior and native application acceptance are unverified.
