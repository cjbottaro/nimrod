# Theme catalog maintenance

Theme discovery uses a checked-in VS Code theme catalog. **Normal development
builds and app startup never fetch or regenerate it.** This is separate from
building a development app for the `nimrod` CLI.

## Discovering Open VSX themes

Run **`mise run themes-discover`** explicitly to search Open VSX's Themes category
by download count, inspect color-theme contributions in `package.json`, and write
`tools/theme-bundler/open-vsx.lock.json`. Then run `mise run themes-update` to
regenerate the bundled catalog. Neither command is part of normal app builds.

The initial policy examines a window of 200 registry results until 50 compatible
packages are accepted. The completed discovery inspected 121 of 1,951 results:
50 accepted packages / 259 variants and 71 recorded exclusions. Combined with the
original eight snapshots, the catalog contains **267 variants**. This is not an
exhaustive registry mirror. The lock retains the report and explicit pinned
versions/download URLs/SHA-256 checksums; inspect it before a release.

Icon-only extensions, deprecated entries, missing license notices, unsupported
license declarations and incompatible palettes are skipped with recorded reasons.
Current license policy accepts MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC and
MPL-2.0; other declarations require separate review. All declared JSON variants in
an accepted package are bundled. Duplicate-looking variants across publishers or
legacy source snapshots are retained rather than silently removed.

## Preparing a catalog update

1. For registry themes, run `mise run themes-discover` and review the resulting
   version/checksum lock and omission report. For the retained raw-repository
   sources, edit `tools/theme-bundler/sources.json`: add an explicit theme path and stable
   ID, or advance a source's pinned 40-character Git revision. Retain author,
   license identifier and the path to its complete license notice.
2. Run the Rust maintenance program explicitly:

   ```sh
   mise run themes-update
   ```

3. Review `src/themes/catalog.json` and `THEME_CATALOG_NOTICES.md`, then run
   `mise run themes-check`, `mise run check`, and `mise run build`. Validate
   representative theme colors in the app before publishing a real release.
4. Commit the manifest and generated files together when approved. Future normal
   builds use this snapshot without repeating collection.

No latest-branch fetching occurs implicitly: changing revisions is deliberate.
To reproduce a bundle using only downloaded source files:

```sh
mise exec -- cargo run --locked --manifest-path tools/theme-bundler/Cargo.toml -- --offline
```

The ignored `.theme-source-cache/` is optional maintenance data, not an app
dependency. A fresh checkout can build the app without it. Missing files, invalid
themes or collection failures abort without replacing the existing bundle.

## Initial scope and boundaries

The collection contains 259 variants from 50 pinned Open VSX packages plus the
original eight dark/light snapshots from five repositories. This is explicitly
curated, not an exhaustive Marketplace mirror. Existing built-in Dracula,
Tokyo Night (Omarchy) and Osaka Jade are preserved.

For Open VSX, the builder downloads checksum-pinned VSIX packages, reads only
bounded text assets in memory (no extraction to filesystem or extension execution),
and resolves contributed color themes. Full licenses and root NOTICE files are
retained. Only Open VSX and its Eclipse content host are permitted for redirects.
For legacy raw-repository sources, it downloads pinned JSON/JSONC and license files directly, resolving
relative `include` and external token-color JSON/TextMate files inside the same
repository. It does not need to clone whole repositories or run their build
scripts. Generated files retain full token rules and semantic color data for
future use; today's renderer still maps only broad syntax foreground categories.

Open VSX supplies published generated JSON even where author repositories contain
only templates—official Dracula is now included through its package. Existing
built-in Dracula remains a separate hand-tuned option. The tool never runs
upstream generators.

Stable `catalog-…` IDs mean a new app release can update a bundled theme in place.
Manually imported and legacy Gogh copies remain independent and are not rewritten.
There is no runtime updater, catalog Refresh control, extension installation,
font/layout import or Highlight.js replacement.

See [Themes](themes.md) for picker behavior.
