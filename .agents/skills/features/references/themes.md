# Color themes

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#themes) retain prior execution records.

Human guide: [Themes](../../../../docs/themes.md). Maintenance guide:
[Theme catalog](theme-catalog.md).

## Specification and acceptance criteria

Theme application changes palette CSS colors only. After CSS is complete, `applyTheme` publishes a root-local mode/background/palette-signature snapshot through `themes/applied-theme.ts`; the separate [window-presentation pipeline](window-presentation.md) consumes this explicit notification for native appearance, including previews/restoration, without rewriting palettes or observing DOM mutations. Theme selection in a project window (Settings or palette) creates a project override; global Settings edits the default. Inheriting projects follow global changes; explicit overrides do not. Imports/removal remain global-only, and project pickers use the shared global library without copying palettes. [Preferences](preferences.md#project-layering) owns precedence/reset semantics. Window-local previews never persist/broadcast; cancellation restores the latest committed theme. Imports remain bounded standalone files, catalog IDs stay stable, and no runtime networking occurs.

## Code map and invariants

- [Text-selection contrast](#text-selection-contrast) is shared by every palette, independently of list-row selection; no theme-specific highlight overrides.

- `src/themes/theme.ts`: bounded JSONC importer, hex allowlist, broad syntax
  mapping, fallback derivation, imported-library validation and CSS-only application.
  `BUILTIN_THEME_IDS` preserves Nimrod/Dracula/Tokyo Night/Osaka Jade;
  `CATALOG_THEME_IDS` comes directly from the generated catalog. No registry cycle. JSON imports explicitly declare `with { type: 'json' }` for the pinned Node ESM/Playwright loader as well as bundler execution.
- The importer/application allowlist includes all 16 `terminal.ansi*` standard/bright colors for [console-style tool output](transcript-cards.md#console-style-command-output). Missing terminal tokens use renderer fallbacks; managed-property cleanup removes prior-theme palette values on switching/reset without rebuilding console DOM.
- Filled-button readability is a shared presentation policy in `src/button-surfaces.ts`, documented in [Translucency](translucency.md#filled-control-contrast). It applies equally to Nimrod, built-ins, catalog and future imported palettes; no bespoke theme fixes. Stable opaque text and palette-derived fill floors replace foreground interpolation. Original palette tokens remain unchanged; unreadable/alpha button pairs receive derived control-specific repair.
- `src/themes/applied-theme.ts`: root-local current snapshot and explicit subscriptions, published only after `applyTheme` finishes CSS application. Same-mode palette changes, previews and rollback reach the same presentation boundary; no persistent/global preview broadcast.
- `src/themes/builtins.ts`: existing adaptations plus `CATALOG_THEMES` parsed by
  the normal importer. `selectedTheme` is shared by Settings, project windows and
  pop-outs. Catalog source metadata provides author text for picker search.
- `src/themes/picker.ts`: Settings **Change theme…** action entry, saved-theme label, global-only import/removal buttons, collision-safe names (also against catalog names), stale-file guards and local preview/restore. Only imported copies can be removed.
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

## Text-selection contrast

`src/text-selection.ts` derives presentation-only highlight/text pairs, without theme IDs or source-palette mutation. `src/window-appearance-controller.ts` computes separate pairs against the nominal editor, input, code and widget backings at installation, completed theme publication (including same-ID previews/restoration) and inherited-system appearance changes. Opacity slider ticks do not recompute or fade them. The shared `src/theme.css` `::selection` rule consumes these roles throughout project, Settings and reference windows; inputs/textareas, code and widget containers select their matching backing roles. Before installation and in forced-colors mode, selection uses system Highlight/HighlightText colors.

Prefer the general UI `selection.background`, then `editor.selectionBackground`; this is DOM text selection, not an embedded editor. Preserve both original tokens independently. Missing selection roles start with a subdued 35% focus-accent blend against the backing, not a full-strength accent or `list.focusBackground`. `editor.selectionForeground` is imported/managed, with normal foreground as its default. Reset clears source overrides and the appearance subscription recomputes derived roles. List/quick-input/suggestion selected-row roles retain their existing recipes.

Composite source highlight alpha against the nominal backing and serialize the derived highlight with alpha **254/255** (`#RRGGBBfe`), independently of the window-opacity slider. WebKit's [`RenderTheme::transformSelectionBackgroundColor`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderTheme.cpp) calls [`blendWithWhite`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/ColorBlending.cpp): fully opaque author selection colors are rewritten as translucent colors calibrated for white. This can erase an otherwise contrasting gray highlight on dark surfaces even though `getComputedStyle(..., '::selection')` reports the intended color. The one-byte alpha difference bypasses that rewrite across platforms; do not make this a theme-ID or UA exception or round the alpha back to 1.

Preserve the derived RGB if its composited nominal-backing contrast is at least 3:1; otherwise search toward black and white and choose the passing serialized color with the smallest RGB displacement. Preserve an opaque supplied foreground only if its worst-case highlight contrast at 254/255 alpha is at least 4.5:1 over any sRGB underlay; otherwise choose a passing black/white foreground. Both thresholds are application presentation policy, not native accessibility certification.

The near-opaque highlight protects selected-text contrast independently of window opacity or the desktop. Highlight/background contrast is guaranteed only against each **nominal palette backing**: arbitrary desktop content under transparent surfaces, custom/plugin backgrounds and native inactive-selection painting require visual acceptance, not claims based on palette math. No desktop sampling, native changes, DOM replacement, draft/focus/selection mutation or scroll effects.

`test/text-selection.test.ts` sweeps bundled/catalog palettes and synthetic imported/alpha/mid-tone cases, including paint-alpha contrast bounds; controller fixtures cover preview/reset and retained draft selection; `test/browser/text-selection.spec.ts` covers computed WebKit highlight roles on content, inputs, code and widgets across system schemes, themes and opacity. `test/browser/text-selection-paint.spec.ts` compares actual selected/unselected screenshot pixels in the composer and transcript for Nimrod and Sweet Dracula across both system schemes and opacity 0/65/100. Computed colors alone are not a selection-paint regression check. [Verification](verification.md#text-selection-contrast) owns execution/acceptance status.

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
- `src/themes/selection.ts:createThemeSelection` shares the **Select theme…** action between project and Global Settings bootstraps; Settings **Change theme…** invokes that same interaction. It combines Nimrod, existing built-ins, saved imports and
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
  overriding a newly opened picker. Accepted global selection updates inheriting project
  windows/pop-outs; project selection affects its own project window and owned reference pop-outs through native scoped snapshots. No preview persistence/broadcast.
- Settings remains mounted beneath the theme picker. Explicit preview entry accepts its owning Settings dialog; unrelated/nested dialogs still block interaction. Escape/Back restores the latest committed palette and focus to **Change theme…** without closing Settings. Other palette entries retain their existing modal guards.
- `select-theme` is application-context, registered and bindable via shared dispatcher, with empty
  default shortcuts. Picker entry/shortcut/modal priority are harness-independent.
- Former `import-gogh-*` saved copies and optional `{provider:'gogh', author}`
  metadata remain valid and visible. No deletion/migration of user settings or
  `nimrod.themes.gogh.v1` state cache; that old cache is now inert. Native Gogh
  command and source module were removed. Catalog release updates replace bundled
  data under stable IDs but never overwrite manually imported/Gogh copies.

## Catalog maintenance boundary

[Theme catalog](theme-catalog.md) owns discovery, pinned sources, archive limits, license policy, generation and atomic-output procedure. Runtime import does not gain catalog-time include/token resolution or HTTP capabilities. Catalog updates remain explicit and never run during app build/startup.

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
- When validation is explicitly requested, use `mise run themes-check`, `mise run test` and the offline browser
  suite; do not run tests/checks automatically. Explicit maintenance generation is separate from tests. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow).
