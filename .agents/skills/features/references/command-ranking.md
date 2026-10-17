# Command palette ranking

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#command-ranking) retain prior execution records.

Human guide: [Command palette ordering](../../../../docs/command-palette.md).

## Specification and acceptance criteria

Only command-mode accepted actions update bounded app-wide MRU history. Picker ordering, direct shortcuts, cancellation and hover remain independent; persistence failure never blocks or retries execution.

## Code map and strategy boundary

- `src/command-ranking.ts`: `CommandRankingStrategy.rank(commands, { query, usage })`, default `vscodeMruRanking`, validated usage reader and data types. Ranking receives already-filtered commands and returns a new array; it must not mutate inputs. Query is provided for future relevance-aware strategies. Stable IDs, not labels, identify commands.
- `src/command-palette.ts`: optional `PaletteOptions.ranking` supplies a strategy, usage reader and acceptance recorder. No injected strategy defaults to MRU, with empty usage when no recorder exists. Only command-mode matches are ranked; session/selection pages are not. Highlight preservation and existing filter semantics remain intact.
- `src/main.ts`: uses app-wide preference snapshots for usage and sends acceptance to native persistence. A persistence error gets a history-specific message and never delays/replays execution. No new Settings option.
- `src/preferences.ts`: queued `recordCommandUsage` host operation; returned/broadcast snapshots follow existing revision ordering. Read latest usage on opening/drawing rather than keeping a stale window-local cache. An already-visible palette is not actively reshuffled by another window's acceptance; the next draw/open sees it.
- `src-tauri/src/command_usage.rs`: bounded strategy-independent history mutation.
- `src-tauri/src/preferences.rs`: `record_command_usage` IPC and mutex-protected `change_state` read-modify-write. This avoids concurrent windows replacing each other's whole history arrays. Uses existing atomic state writer and broadcasts; no dedicated storage service or settings edits.

## Usage format and invariants

App-state key `nimrod.command-usage.v1`: `{ version: 1, entries: [{ id, lastUsedAt, useCount }] }`. Newest first, at most 50 distinct IDs. Timestamps are Unix milliseconds, counts positive JS-safe integers. Counts saturate at the JS maximum; eviction loses prior counts. Unknown IDs remain until eviction, never create commands. Bad history versions/shapes/entries fall back to valid history/empty; malformed whole app-state files continue to fail closed through Preferences.

Native serialized mutation order defines recency, even for equal timestamps or a backwards clock. MRU ignores both counts and timestamps. Usage includes these fields so another ranking strategy can later consume them without tying persistence to MRU. A future exact decayed-frequency strategy may need additional statistics/schema migration; do not imply bounded last-use/count aggregates preserve the full event history.

Record once on command acceptance, before `next` navigation or post-close action scheduling. Picker/naming entry counts even if its child page is canceled. Command execution errors count as accepted attempts, matching VS Code's history-before-execution behavior. No highlighting, cancellation, Back, picker choice, button or direct-keybinding recording. Existing acknowledgement, focus restoration and single-execution boundaries are unchanged.

To add an algorithm, implement `CommandRankingStrategy` and inject it through `PaletteOptions.ranking.strategy`; later resolve a saved strategy ID at the composition root. Do not put strategy selection inside filtering, usage persistence or per-picker code. Full VS Code fuzzy matching, TF-IDF suggestions, separators and history-removal controls are outside this feature.

## Tests and acceptance

- `test/command-ranking.test.ts`: MRU vs frequency/clock, alphabetical fallback, immutability, validation, bounds, fixture restore.
- `test/command-palette.test.ts`: injected alternate ranker, query/filtered-input contract, acceptance vs dismissal, next-page entry, repeated Enter, independent selection ordering.
- `test/shell.test.ts`: real shell reads saved history, persists palette acceptance, stable dynamic labels, direct shortcuts excluded.
- `test/browser/command-ranking.spec.ts`: offline WebKit saved-MRU ordering, picker-entry acceptance, filtering, draft preservation and modal-close focus.
- Rust `command_usage` tests: recency order, repeats, counts, bounds, invalid-entry recovery.
- Rust Preferences test: concurrent writers retain all counts, atomic disk restore, malformed-file failure.

Validate `mise run test`. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow). Offline DOM/unit evidence is not native Tauri visual acceptance or Linux/Windows parity. No app launch or live Pi calls are needed.
