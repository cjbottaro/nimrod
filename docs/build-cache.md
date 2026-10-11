# Shared build cache

Rust, Node and sccache are pinned in `mise.toml`. Install them in an updated checkout:

```sh
mise trust
mise install
mise run check
```

Mise sets `RUSTC_WRAPPER=sccache` and `CARGO_INCREMENTAL=0`. Builds in `main`
and worktrees using this configuration automatically read and populate the same
machine-local compiler cache. No Homebrew installation, symlinks or shared Cargo
target directory are needed. Worktrees under this repository's `.worktrees/`
inherit main's mise configuration automatically, including existing branches with
older `mise.toml` files, unless they explicitly override it. Worktrees outside this
repository directory need the updated configuration in their own branch.

## What is shared

- Compatible Rust dependency compilations, including dependencies compiled first
  in a worktree and later reused by main (or the reverse).
- Cargo's registry/download cache and npm's download cache, already shared by default.

Each checkout owns `src-tauri/target/`, `dist/`, `node_modules/` and its initial
packaged output. Leave `CARGO_TARGET_DIR` unset to keep compilation isolated.
Publishing a finished app is separate from sharing compiler targets.

## Requested app builds

Agents run checks and relevant offline tests, but do not automatically build/package
the app—even at task completion or after a merge. Ask explicitly when you want a
build; this keeps concurrent worktrees from saturating the CPU.

A request to **build the app** means build the requested worktree's source before
merge, or `main` after merge, and publish the finished artifact to the primary
checkout on `main` so the installed `nimrod` CLI picks it up. The request authorizes
replacing that artifact; manually requested builds can overwrite each other's output.
It does not authorize a merge or app launch/restart.

`mise run build` itself only packages/verifies the current checkout. For a worktree
build, the agent must additionally copy the complete verified macOS bundle to the
primary checkout's `src-tauri/target/release/bundle/macos/Nimrod.app` (or publish the
Linux executable to `src-tauri/target/release/nimrod`). Keep the CLI installed from
the primary checkout; do not repoint it to a temporary worktree. An explicit alternate
destination or isolated-build request overrides this default.

A running app keeps its old code until you quit and relaunch it. Agents do not do
that as part of building. Linux publication is intended behavior, not locally
verified acceptance; no Windows CLI wrapper is currently provided.

## Cache boundaries

Cache hits require compatible compiler versions, flags, features and source inputs.
Debug and release compilations have different keys. Checkout-local Rust sources can
miss because their absolute paths differ. Final linking, procedural macro crates,
and some check/Clippy invocations are not cacheable; a warm cache is not a zero-work
build. Disabling incremental compilation makes eligible debug builds cacheable but
can slow repeated local edits compared with Rust's incremental compilation.

## Inspect the cache

```sh
mise exec -- sccache --show-stats
```

The output includes the cache location, size, hits, misses and non-cacheable reasons.
The default disk-cache limit is 10 GiB. Default locations are
`~/Library/Caches/Mozilla.sccache` on macOS and `~/.cache/sccache` on Linux
(respecting the relevant cache-directory environment overrides). The cache is
shared across projects too, with compiler/input keys distinguishing their entries.
Existing personal sccache configuration or `SCCACHE_*` environment overrides can
change the backend/location; this project does not replace them or configure a
remote cache.

Use `mise run ...` or `mise exec -- cargo ...` to ensure the wrapper and pinned
tools are active. Plain Cargo commands outside a mise-activated shell need not
use this configuration. Old build artifacts do not retroactively populate the
compiler cache; it warms as compilation occurs through sccache.

The setup and bidirectional offline fixture reuse have been verified on macOS.
Linux and Windows behavior has not been verified locally.
