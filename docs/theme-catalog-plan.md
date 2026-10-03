# Theme catalog — deferred implementation

**Status: recorded for later, not authorized for implementation now.** The user explicitly chose to keep the existing Nimrod/Dracula picker and VS Code JSON/JSONC importer for the time being. This document describes a future direction, not current functionality. Resume only when requested.

## Goal

Make discovering and choosing themes easy inside Nimrod:

**Settings → Appearance → Theme picker → Browse themes… → searchable previews → Apply**

The user raised terminal-theme repositories because they provide accessible collections of palettes. The important requirement is easy discovery/selection, not loyalty to the VS Code file format. Asking people to search GitHub for raw files or export from another editor should be the advanced path, not the normal experience.

## Proposed approach

- Start with a bundled, pinned catalog from [Tinted Theming's schemes](https://github.com/tinted-theming/schemes), initially considering Base16. Its defined color roles offer a consistent basis for UI and syntax mapping.
- Map source palettes into Nimrod's existing color roles. A terminal-oriented palette can work without defining every widget color; derive missing surfaces, borders, accents and status colors deliberately.
- Browse/search names with visual previews, then apply a selection. Keep discovery local and usable offline; no dependency on a live website or automatic startup downloads.
- Preserve the bespoke **Nimrod scheme** as the default. The user prefers it to Dracula after comparing them directly; additional themes are alternatives, not a reason to redesign it.
- Keep the current VS Code importer. Consider adding Base16 palette files and Windows Terminal JSON as additional manual-import formats.
- Keep the current color-only boundary: importing palettes must not install extensions, run scripts, load arbitrary CSS, or change fonts/layout.

## Relevant sources

- [Tinted Theming](https://github.com/tinted-theming/schemes): Base16/Base24 palettes; proposed first catalog source. Base24 support is not yet decided.
- [iTerm2 Color Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes): broad public collection with previews, YAML sources and Windows Terminal JSON. Useful potential catalog/import source.
- [Gogh](https://github.com/Gogh-Co/Gogh): another public terminal-palette collection to evaluate if needed.
- [VS Code Themes](https://vscodethemes.com/): useful discovery gallery, but generally extension-oriented rather than a direct standalone JSON import service.

These links are research leads, not runtime dependencies or commitments to support every format.

## Decisions to resolve when implementing

- Exact source revision, catalog breadth, theme licenses and retained author attribution. Make any curation explicit; do not silently present a subset as the full upstream collection.
- Stable catalog IDs, duplicate names, and separation from locally imported themes and built-ins.
- Palette-to-UI mapping for light/dark variants and readable status/syntax colors; verify representative schemes rather than assuming one mapping makes every palette attractive.
- Preview behavior: whether it previews a sample or the whole app. If preview changes the live app, cancellation must restore the previous theme and preview must not persist as an applied choice.
- Catalog updates: begin with app-bundled snapshots; no background updater is implied.

## Acceptance expectations

- Search, preview and apply without downloading files or using VS Code.
- Bundled themes work offline; selection survives relaunch.
- Explicit Apply/cancel behavior and honest failures; existing imported themes remain usable.
- No changes to Pi/harness state, drafts, zoom, disclosure choices, focus ownership or transcript scroll intent.
- Tests for mapping, catalog identity, persistence, preview rollback and actual UI color/layout behavior. Native WebKit acceptance remains distinct from mocked DOM checks.

See [themes.md](themes.md) for the current supported behavior.
