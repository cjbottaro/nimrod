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

Work on a dedicated branch/worktree under `.worktrees/`. Keep compiler targets, `node_modules/` and frontend output checkout-local; do not redirect Cargo targets into another checkout. Mise's shared machine-local sccache reuses compatible Rust dependency compilations; final linking and all checks are not necessarily cacheable. Inspect it with `mise exec -- sccache --show-stats`.

## Checks

```sh
mise run check
npm run check:docs

# Required for scrolling changes; offline demo fixture only:
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

This packages and verifies the current checkout. An agent-directed **build the app** request also includes staging and publishing the finished artifact to the primary checkout's CLI-visible default location. Before merge, build the task worktree's source with its own targets; after merge, build main when asked. A build request does not authorize merging or launching/quitting/restarting the user's app.

- macOS: `src-tauri/target/release/bundle/macos/Nimrod.app`
- Linux: `src-tauri/target/release/nimrod`, with the same-build `esbuild` sidecar beside it.

Keep the installed CLI pointing to the primary checkout. Requested publications may overwrite one another; the user coordinates builds. For staging, signature verification and cache pitfalls, follow the [internal build workflow](.agents/skills/features/references/build-cache.md).

Cargo asset preparation copies a target-matching esbuild binary/license from the installed npm dependency into an ignored staging directory; Tauri packages it as a compiler sidecar. No compiler is downloaded at runtime. Native same-platform builds use `npm ci`; cross builds require the matching target dependency installed locally. Requested macOS verification includes the helper signature. Compiler packaging/execution still needs native acceptance; no app build is part of checks.

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
