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
- Linux: `src-tauri/target/release/nimrod`

Keep the installed CLI pointing to the primary checkout. Requested publications may overwrite one another; the user coordinates builds. For staging, signature verification and cache pitfalls, follow the [internal build workflow](.agents/skills/features/references/build-cache.md).

## Documentation ownership

- `README.md`: product introduction, first use and feature links.
- `docs/`: user-facing features, usage, observable behavior and relevant limitations.
- `.agents/skills/features/references/`: specifications, acceptance criteria, implementation, storage, invariants and platform pitfalls.
- [UI vocabulary](.agents/skills/nimrod-ui-vocabulary/SKILL.md): canonical terms, not duplicate specifications.
- [Verification status](.agents/skills/features/references/verification.md): current evidence boundaries and remaining acceptance.
- Internal `references/history/`: historical execution records, never current requirements.

Use the [features index](.agents/skills/features/SKILL.md) to find the canonical owner of a contract. Behavior changes update both the specification and relevant user guide. Implementation-only changes update internal references; developer tooling changes update this guide and their internal reference. Do not add a skill per feature.

Catalog maintenance is explicit and separate from app builds; see the [theme-catalog procedure](.agents/skills/features/references/theme-catalog.md).
