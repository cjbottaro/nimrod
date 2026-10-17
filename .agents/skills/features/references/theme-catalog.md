# Theme catalog maintenance

**Status: implemented maintenance tooling, not an app feature.** This is the canonical procedure and tool specification. Runtime implementation belongs in [Themes](themes.md); user usage is in the [theme guide](../../../../docs/themes.md).

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
   `mise run themes-check` and `mise run test`. Build/package only when explicitly requested, following the [build workflow](build-cache.md#explicit-build-and-publication-workflow). Validate
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

## Tests and remaining acceptance

`test/theme-catalog.test.ts` checks generated shapes, pinned provenance/licenses and no collection in normal tasks. `tools/theme-bundler/src/lib.rs`/`open_vsx.rs` and CLI integration tests use local fixtures for path/include/archive/checksum/license bounds, offline reproduction and failure preservation.

Run `mise run themes-check` and `mise run test`; no registry access is authorized by routine validation. Historical explicit collection evidence is in [theme records](history/feature-records.md#themes). Native color/focus acceptance belongs to runtime theme work.

