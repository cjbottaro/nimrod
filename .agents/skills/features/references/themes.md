# Color themes

## Code map and invariants

- `src/themes/theme.ts`: JSONC importer, bounded hex-color allowlist, broad syntax mapping, fallback derivation, library validation and CSS-only application. `BUILTIN_THEME_IDS` includes `nimrod`, `dracula`, `tokyo-night`, `osaka-jade`.
- `src/themes/builtins.ts`: bundled JSON palettes parsed through the normal importer, shared registry and `selectedTheme` lookup used by picker and pop-outs. Keep IDs aligned with `BUILTIN_THEME_IDS` and Rust's native validator in `src-tauri/src/preferences.rs`.
- `src/themes/picker.ts`: persisted-before-applied selection, local imports/removal, collision-safe names and stale-file guards. Built-ins cannot be removed; imports named after any built-in get a suffix.
- `src/preferences.ts`: validates selection and syncs JSONC preferences. `src/popout.ts` uses the same selected-palette lookup, never a separate built-in switch.
- Default remains Nimrod/system; other built-ins explicitly stay dark even under light OS appearance. Changes only update managed CSS color variables and color scheme: do not recreate transcript nodes, reset disclosures/scroll/focus/drafts/zoom or invoke Pi.
- Saved `appearance.theme` IDs and `appearance.importedThemes` are app preferences; no schema migration needed for added built-ins. Invalid external selections retain last valid preferences.
- Import accepts standalone VS Code JSON/JSONC only, not Omarchy TOML, arbitrary CSS, URLs or extension packages. Built-in JSON adaptations are themselves importable.

## Omarchy palette provenance and mapping

Tokyo Night and Osaka Jade adapt Omarchy `themes/<id>/colors.toml` at revision
`04b374a989c49bdeda72542f194106ea0c3da3ff` (quattro). See pinned source links and full license notices in `THIRD_PARTY_NOTICES.md`; Tokyo Night is originally by Enkia.

Map background/foreground/accent/selection directly; dark background goes to inputs/code, lighter background to widgets, muted to borders, dark foreground to descriptive text/comments. Broad syntax is a Nimrod adaptation: magenta keywords, green strings, orange constants, blue functions, bright cyan types and bright magenta regexps. No upstream language-specific syntax fidelity claim. Osaka Jade's semantic warning uses bright yellow `#e5c736`, rather than its unusually green normal yellow. Buttons use selection background with bright foreground for readability.

These are offline bundled snapshots, available on all platforms, not automatic desktop theme following. No Omarchy installation, blur, transparency, font change or native-decoration change.

## Tests and verification

- `test/themes.test.ts`: exact base/accent/surface/syntax colors, registry-ID consistency, bounded values, picker persistence/restoration/reload, imported-name collisions, return-to-system clearing and live DOM/focus/draft/scroll preservation across every built-in.
- `test/preferences.test.ts`: JSONC save and external selection updates for both new IDs.
- `test/shell.test.ts`: pop-out live palette changes preserve captured code DOM without Pi operations.
- Rust preferences test accepts all built-in IDs and rejects unknown IDs.
- `scripts/check-themes.mjs`: optional offline Chromium computed-color checks under both OS CSS branches, including both new palettes. Automated browser evidence is not native/platform acceptance.
- macOS verification: `CARGO_NET_OFFLINE=true mise run check` passed 429 TS tests, formatting, Clippy and 107 Rust tests (2 opt-in tests ignored). `CARGO_NET_OFFLINE=true mise run build` passed packaging/signature verification. Optional Chromium color script was extended but not run.
- At the user's explicit request, copied the verified worktree bundle to the primary checkout's `src-tauri/target/release/bundle/macos/Nimrod.app`, the installed `nimrod` CLI's default path. Preserved the previous bundle in `.previous-app.2ngQGi/Nimrod.app` alongside it and verified the installed signature and executable equality. No changes to CLI configuration or main's tracked source.
- Native visual acceptance on macOS and Linux remains user validation; no app windows launched or running app quit by this task. Quit/relaunch is needed to use the newly installed build.
