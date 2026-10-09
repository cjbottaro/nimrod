# Build cache implementation reference

## Code map and invariants

- `mise.toml`: pins `aqua:mozilla/sccache` at 0.18.0 alongside Rust/Node;
  project-scoped `RUSTC_WRAPPER=sccache`, `CARGO_INCREMENTAL=0` apply to dev,
  check, build and `mise exec` Cargo commands.
- No `CARGO_TARGET_DIR`, `SCCACHE_DIR`, remote backend, global Cargo config,
  global mise config or shell startup edits. Use sccache's normal machine-local
  disk cache and preserve personal overrides. Default size is 10 GiB.
- Targets, frontend output and app bundles remain checkout-local. Never point
  worktree builds at the primary checkout's default target or running app bundle.
- Mise merges ancestor configs: once main has this configuration, existing and new
  worktrees nested under `.worktrees/` inherit the wrapper, incremental setting and
  tool pin without changing their tracked files. Explicit child overrides can
  supersede them. External worktrees need the configuration in their own branch.
  Tool installation alone does not enable the wrapper outside this config hierarchy.
- User guide: `docs/build-cache.md`, linked from README and documentation index.

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
