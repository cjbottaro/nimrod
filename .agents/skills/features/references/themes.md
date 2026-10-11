# Color themes

Human guide: [Themes](../../../../docs/themes.md). Maintenance guide:
[Theme catalog](../../../../docs/theme-catalog-plan.md).

## Code map and invariants

- `src/themes/theme.ts`: bounded JSONC importer, hex allowlist, broad syntax
  mapping, fallback derivation, imported-library validation and CSS-only application.
  `BUILTIN_THEME_IDS` preserves Nimrod/Dracula/Tokyo Night/Osaka Jade;
  `CATALOG_THEME_IDS` comes directly from the generated catalog. No registry cycle.
- `src/themes/builtins.ts`: existing adaptations plus `CATALOG_THEMES` parsed by
  the normal importer. `selectedTheme` is shared by Settings, project windows and
  pop-outs. Catalog source metadata provides author text for picker search.
- `src/themes/picker.ts`: persisted-before-applied Settings selection, local
  import/removal, collision-safe names (also against catalog names), stale-file
  guards and local preview/restore. Catalog entries have a distinct Settings
  optgroup; only imported copies can be removed.
- `src/preferences.ts`: TS validation and JSONC synchronization. `selectTheme`
  reads fresh native state, retains concurrent imported additions and CAS writes
  without replay. Catalog selections do not add imports. `appearance.theme` is a
  stable `catalog-<source>-<theme>` ID; `appearance.importedThemes` stays independent.
- `src-tauri/src/preferences.rs`: native selection validation reads IDs from the
  same checked-in catalog via `include_str!`; reject unknown catalog IDs, don't
  merely accept the prefix. No separately maintained list of catalog IDs.
- Nimrod/system stays default. Old built-ins retain existing IDs/appearance;
  imported and catalog themes explicitly select light/dark. Changes update only
  managed CSS variables and color scheme, never transcript DOM, draft/disclosure
  state, zoom, focus/scroll intent or Pi/harness configuration.
- Manual import remains standalone JSON/JSONC (512 KiB, 50 saved imports), not
  arbitrary URLs/CSS/fonts/scripts/includes or extension packages. Catalog-time
  resolution is a maintenance-tool capability, not a runtime importer relaxation.

## Bundled catalog and command-palette picker

- `src/themes/catalog.json`: generated and checked into Git when approved. It
  contains 267 variants: 259 from 50 checksum-pinned Open VSX packages plus the
  original eight variants from five GitHub repos (stable old IDs retained).
  No claim of full Marketplace coverage. Source/license data and original resolved
  token/semantic rules are retained for future renderer work.
- Normal `mise run dev`, `mise run build`, `npm run build` and runtime startup do
  **not** run collection. Bundled data works on a fresh offline first launch. No
  Refresh/download controls, webview external request, native HTTP command or
  application Reqwest dependency. Maintenance tool is a separate Rust crate.
- `src/main.ts:pickTheme` combines Nimrod, existing built-ins, saved imports and
  catalog. `src/command-palette.ts:startPreviewSelection` shares normal lifecycle:
  arrow/filter/mouse movement previews the initiating window only; Enter/click
  persists through post-close acceptance; Escape/native/API close/Back/page
  replacement/disposal rolls back. Empty filters restore committed colors.
- Transparent backdrop and 32vh list cap expose the conversation. Theme current
  marker follows the title in an 8px trailing slot; label is shrinkable but not
  growing, so titles align with descriptions. Model/thinking/project dots stay
  leading. `aria-current` tracks committed selection independently of navigation
  `aria-selected`. Enter hint stays right-aligned and reserves its space.
- `installThemes.preview/restore` prevents a committed preference broadcast from
  overwriting a local preview. Cancel restores **latest** committed selection,
  including another window's change, not a stale opening snapshot. Failure restores
  committed colors; newer preview generations prevent old save completions from
  overriding a newly opened picker. Accepted selection updates other project
  windows/pop-outs normally. No preview persistence/broadcast.
- `select-theme` is registered and bindable via shared dispatcher, with empty
  default shortcuts. Picker entry/shortcut/modal priority are harness-independent.
- Former `import-gogh-*` saved copies and optional `{provider:'gogh', author}`
  metadata remain valid and visible. No deletion/migration of user settings or
  `nimrod.themes.gogh.v1` state cache; that old cache is now inert. Native Gogh
  command and source module were removed. Catalog release updates replace bundled
  data under stable IDs but never overwrite manually imported/Gogh copies.

## Rust maintenance tool

- `tools/theme-bundler/` is a standalone binary/library crate with its own pinned
  Cargo.lock. `sources.json` explicitly lists repository, immutable 40-digit
  revision, source ID, author/license path and stable theme IDs/names/paths/modes.
- Explicit `mise run themes-update` downloads bounded raw files at the pinned
  revisions (no whole clone, extension install or upstream scripts). Add/update
  sources by editing the manifest, not implicitly chasing HEAD. `--offline` uses
  cached pinned files only; `--manifest/--output/--notices/--cache` are override paths.
- `src/lib.rs`: validate IDs/repositories/metadata, JSONC comments/trailing commas,
  normalize repository-relative paths, resolve include trees and token-file
  JSON/TextMate XML, detect cycles/depth, merge child colors and append token rules
  after parent rules. Preserve semantic data. Reject URLs/absolute/backslash paths
  and repository escapes. Plain XML parsing never retrieves external resources.
- Bounds: 100 sources, 100 explicit themes/source, 512 KiB/source or resolved theme,
  32-level include depth, 16 MiB compact bundle. Bounds fail visibly, never truncate.
  Hex colors required; explicit normalization of legacy token `white`/`black` to
  hex and removal of `inherit` preserves existing source compatibility. Runtime
  importer still accepts only hex values. Type/name are manifest-owned.
- `src/main.rs`: 30-second HTTPS request timeout, no redirects, bounded stream read,
  per-run dedup and optional ignored `.theme-source-cache/` keyed by pinned path
  hash. Bundle provenance hashes actual source bytes (including license/includes).
  Builds never need this cache. Editing/deleting cache is maintenance-only.
- All collection/resolution/validation must succeed before output replacement.
  Temporary files plus same-directory replacement preserve old output on collection
  failure. Notices and catalog are individually atomic, **not** a two-file atomic
  transaction; if filesystem replacement fails between them, rerun/review both.
- Outputs: `src/themes/catalog.json`, `THEME_CATALOG_NOTICES.md`; commit/review
  manifest and generated files together only with permission. Both old notices and
  generated catalog notices are packaged as Tauri resources.
- Current Dracula repo commits YAML source, not declared generated JSON; Open VSX
  published packages supply generated official Dracula/Soft JSON without executing
  upstream generators. Hand-tuned built-in Dracula remains separate. Template/published-artifact adapters are future explicit work. Similarly,
  Highlight.js remains unchanged; full TextMate/Shiki migration is separate work.

## Open VSX discovery and locked packages

- `tools/theme-bundler/src/open_vsx.rs`: `mise run themes-discover` searches Themes
  by download count, bounded 2×100 search window / 50 accepted-package target.
  Initial run inspected 121 of 1,951 results; 50 accepted packages / 259 variants,
  71 omitted with reasons in `open-vsx.lock.json`. No exhaustive coverage claim.
- Inspect version metadata and `package.json` for actual `contributes.themes`
  (category includes icon themes). Each accepted package contains all compatible
  declared JSON/JSONC variants; reject package if a variant fails resolution/color
  validation. No silent per-package sampling. Licenses accepted explicitly:
  MIT/Apache-2.0/BSD-2-Clause/BSD-3-Clause/ISC/MPL-2.0. Other declarations, missing
  full license notices, deprecated/icon-only/non-JSON packages are reported.
- Lock: namespace/name/version, pinned download URL, registry SHA-256, license path,
  author and stable contribution IDs from normalized paths. Labels/versions/order
  don't change IDs; path changes do. Discovery is the only latest-version search;
  `themes-update` consumes the lock without rediscovery. `--registry-lock` overrides
  it (isolated CLI tests explicitly pass a nonexistent lock).
- Native maintenance HTTP client: 40-second requests; redirect allowlist only HTTPS
  `open-vsx.org`/`openvsx.eclipsecontent.org`, max 3 redirects. Fixed pinned registry
  URL validation and SHA-256 verification before caching/collection, including
  cached bytes. `.theme-source-cache/ovsx-<sha>.vsix` is ignored maintenance data.
- `archive_files`: in-memory ZIP reading, never filesystem extraction. 32 MiB archive,
  128 MiB declared expansion, 20,000 entries and 512 KiB text bounds. Reject symlinks,
  traversal/absolute/backslash paths, duplicate normalized paths and oversized data.
  Read only JSON/JSONC/TextMate/license/notice text, never executable code.
- Reuse existing include/token resolver and hex validator. Root NOTICE files append
  to full license text; manifest/file digests plus package hash retained in source
  provenance. `registry` metadata adds version/checksum information; legacy GitHub
  provenance remains unchanged. Generated notices link to registry/source pins.
- Legacy snapshots and publisher variants may duplicate names/palettes; retained
  for ID compatibility and transparency, author subtitle disambiguates. A future
  dedup UX is separate work. Current renderer only broad syntax, not extension CSS.
- Catalog grew to ~10.9 MB resolved JSON. Rust settings validator caches exact ID
  set via `OnceLock` rather than reparsing catalog on every selection/snapshot.
  Registry/assets are consumed only during explicit maintenance, never runtime.

## Existing palette provenance

Tokyo Night and Osaka Jade adapt Omarchy `themes/<id>/colors.toml` at revision
`04b374a989c49bdeda72542f194106ea0c3da3ff` (quattro). Source links/license notices are
in `THIRD_PARTY_NOTICES.md`; Tokyo Night originally by Enkia. Map bases/accent/selection
explicitly, darker backgrounds to inputs/code, lighter backgrounds to widgets,
muted colors to borders/comments. Syntax is a Nimrod adaptation; Osaka Jade warning
uses bright yellow `#e5c736`, not its unusually green normal yellow. These remain
bundled dark snapshots, not Omarchy installation/desktop following.

## Tests and verification

- `test/theme-catalog.test.ts`: checked-in resolved file shapes, TS importer parity,
  pinned sources/licenses/digests, shared ID selection and no collector in normal
  tasks/application native boundary.
- `tools/theme-bundler/src/lib.rs` tests: deterministic JSONC/include merge, external
  JSON/TextMate tokens, cycles/paths/bad colors/missing files/unpinned manifests,
  file limits and empty licenses. Tests use local fixtures, never upstream.
- `test/themes.test.ts`, `test/preferences.test.ts`, `test/shell.test.ts`: base
  mapping/import rules, persisted selection/restoration, legacy saved Gogh imports,
  modal acceptance/rollback, failure/no replay, bind/unbind, mounted DOM/draft/focus
  invariants and cross-window preferences. Rust validator covers every catalog ID.
- `test/command-palette.test.ts`: shared page cancellation/disposal and trailing-dot
  structure, preserving model/thinking and ordinary page lifecycle.
- `test/browser/themes.spec.ts`: real offline WebKit CSS title alignment, dot after
  title, keyboard/hover preview dark/light, Enter acceptance and Back/Escape rollback
  without conversation replacement/downloads. Native acceptance is distinct.
- Validate with `mise run themes-check`, `mise run check`, `mise run build` and
  offline browser suite. Explicit maintenance generation is separate from tests.

### Open VSX verification

On `feature/open-vsx-themes`, tool formatting/Clippy and 7 offline Rust tests
passed (6 library, 1 CLI integration). `mise run check` passed 436 TS/Node tests,
formatting/Clippy and 108 app Rust tests (2 opt-in live-Pi smokes ignored). Explicit
registry discovery/collection succeeded; cache-only regeneration is byte-identical.
Signed `mise run build` passed; artifact:
`.worktrees/open-vsx-themes/src-tauri/target/release/bundle/macos/Nimrod.app`.
The first full WebKit run passed 51 tests and exposed a test-only adjacency
assumption in the theme test (new duplicate variants); corrected test passes
in isolation and the final full suite passed all 52 tests. No live app
launch/quit or user model/session requests.

At the user's explicit request, installed the verified 267-variant app at the
primary checkout's `src-tauri/target/release/bundle/macos/Nimrod.app`, used by the
installed `~/.local/bin/nimrod` symlink. Previous eight-theme bundle retained at
`src-tauri/target/release/bundle/macos/.previous-app.4ljWdM/Nimrod.app`. Verified
installed signature and executable equality with the worktree build. No CLI
configuration or primary tracked source changes. User must fully quit/relaunch
the running older app; installation did not launch or quit any window.

### Previous bundled-source verification

On `feature/bundled-vscode-themes`, `mise run check` passed 436 TS/Node tests,
formatting/Clippy and 108 Rust tests (2 opt-in live-Pi smokes ignored). All 52
offline WebKit tests passed. `mise run themes-check` passed formatting/Clippy,
4 library tests and the offline CLI integration test. Initial explicit collection
succeeded; offline regeneration is byte-identical for catalog and notices.
`mise run build` passed and verified the macOS bundle signature. Build artifact:
`.worktrees/bundled-vscode-themes/src-tauri/target/release/bundle/macos/Nimrod.app`.
No app launch/quit or live sessions/model requests. At the user's subsequent
explicit request, installed the verified app at the primary checkout's
`src-tauri/target/release/bundle/macos/Nimrod.app`, used by `~/.local/bin/nimrod`.
Retained the previous Gogh app at
`src-tauri/target/release/bundle/macos/.previous-app.glAQyH/Nimrod.app`; verified
installed signature and executable equality. No CLI config/primary tracked source
changes. Quit/relaunch is user-controlled.
Native visual acceptance and Linux/possible Windows verification remain pending.

## Development history

Prior Gogh implementation lives uncommitted in `.worktrees/gogh-theme-picker` and
was copied as this feature's starting point without committing or discarding it.
That earlier build was installed at the primary CLI path with user permission;
previous bundle retained at `.previous-app.Y5j43z/Nimrod.app`. This worktree's build
subsequently replaced that CLI bundle on explicit request (see verification above),
without launching/quitting the user's app.
Native palette visual/focus acceptance on macOS and Linux remains user validation;
possible Windows support is not verified parity.
