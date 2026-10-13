# Preferences, bookkeeping and window state

**Status: implemented.** User guide: [Settings](../../../../docs/settings.md). Related: [Settings layout](settings-layout.md), [drafts/session storage](projects-and-sessions.md#ownership-discovery-and-persistence), [build workflow](build-cache.md).

## Specification and acceptance criteria

Separate user-editable JSONC settings from app-managed state and session-local drafts. Preferences synchronize across windows without recreating conversations, restarting agents, settling submissions or replaying prompts. Runtime edits require explicit Save and affect a future launch snapshot only.

Missing keys use defaults; malformed external files retain the last valid snapshot (defaults on fresh launch), flag the gear and expose errors. Correcting a file clears the error. UI saves preserve comments/unrelated keys and reject malformed/conflicting source, not silently retry.

## Code map

- `src/preferences.ts`: JSONC patches, validation, legacy migration, revision ordering, pending state-write comparison and native bridge.
- `src/settings.ts`: Runtime dirty fields, explicit Save, page modality and focus.
- `src/settings-navigation.ts`, `src/sidebar-resize.ts`: layout-only policies; [Settings layout](settings-layout.md) owns these contracts.
- `src/main.ts`: boot initialization, committed next-launch preferences and focus guards.
- `src-tauri/src/preferences.rs`: XDG paths, polling, serialized same-directory replacement and broadcasts.
- `src-tauri/src/window_state.rs`, `native_menu.rs`: geometry capture/restore and app-owned macOS Quit.
- `index.html`, `src/theme.css`, `src/workspace.css`: mounted page surfaces and error presentation.

## Storage and synchronization

Defaults: `~/.config/nimrod/settings.json`, `~/.local/state/nimrod/state.json`, and saved snapshots in `~/.local/state/nimrod/popouts/`. Absolute XDG roots override on all platforms; empty/relative overrides fall back to home. Windows uses the user's home, not a registry/AppData-only layout.

The separate personal plugin bundle cache uses absolute `XDG_CACHE_HOME` or `~/.cache/nimrod/card-plugins/`; it is disposable compiled data, not settings, state, drafts or Pi history. Personal source placement grants directory trust; `cards.autoLoad` is a validated boolean escape hatch. Legacy per-manifest trust remains independent.

Settings include appearance, notification boolean, [performance-diagnostics opt-in](performance-diagnostics.md), runtime paths, keybinding overrides and [card-plugin autoload/legacy manifests/trust/renderer overrides](card-plugins.md#current-code-and-preserved-evidence). Feature references own their schemas. State includes project/session layout, recency, last-session pointer, widths, command history, geometry, pop-out references and deletion guards. [Editable draft records](native-drafts.md) are scoped Rust-managed files with debounced asynchronous disk saves and no legacy-draft migration; image bytes are separate IndexedDB, temporary bytes memory-only. See [image paste](image-paste.md).

Each preferences/state file retains its 8 MiB cap; saved pop-out content stays in separate bounded files, never embedded in global state.

Rust polls both files every 500 ms, recognizing regular edits, atomic replacement and deletion. Revision-ordered broadcasts reject stale snapshots. Settings deletion resets defaults; state deletion clears remembered disk bookkeeping without closing live sessions. Already-mounted project layouts aren't rebuilt from state broadcasts; Settings width and applicable preferences synchronize explicitly.

Writes serialize natively, preserve dotfile symlinks, compare settings source text immediately before replacement and use same-directory temporary files. Detected CAS conflicts are visible and never retried. External editors remain unlocked; the final check/replacement race is not excluded.

### Unchanged bookkeeping writes

The shell's optimistic `save` adapter uses `saveStateIfChanged`: update local state immediately, but skip state IPC when the requested JSON equals the latest queued value for that key, or (with no pending write/error) the last received native snapshot. Routine foreground/background Pi snapshots may still call `persistTabs`, but unchanged layout does not enqueue a preferences operation, generate IPC, or rewrite state. Actual creation/identity, selection, rename, local Send recency and Close changes retain their existing save boundaries; no debounce, navigation gate, schema change or harness-event coalescing is added.

Track the latest pending value rather than comparing only against committed state: A → B → A must persist the final A even while the received snapshot still contains A. Explicit `saveState` requests share pending tracking, so they cannot be hidden by the conditional adapter. Capture JSON values before enqueueing to prevent later caller mutation from changing an in-flight request. A suppressed call returns no Promise, avoiding duplicate error handlers for the same pending request. Success/failure clears only its own matching pending entry; failures never become a durable-success cache and are not automatically replayed. A later independently triggered save can attempt the value again. Existing error routing is unchanged.

Frontend comparison follows revision-ordered snapshots, including external edits/state deletion, not the shell's optimistic `localState` map. It does not perform a fresh native read for a suppressed call; existing 500 ms polling/broadcast visibility and external-writer race boundaries still apply. Already-mounted layouts remain shell-owned rather than being rebuilt from external state.

Native `change_state` refreshes/validates files, merges the patch, and applies version normalization **before** comparing the resulting state to the refreshed snapshot. Equality returns the current snapshot without replacing the file or advancing its revision. This covers all native state mutation callers, preserving unrelated external keys and formatting on no-ops. Missing/deleted state is recreated on a real change; malformed-file and missing-entry guards remain effective even for identical patches. Native command responses/broadcast routing remain unchanged.

## Migration and lifecycle

Valid legacy theme/runtime/layout/recents/sidebar/last-session state migrates once, marked in versioned state. Existing configuration wins and sources are retained. State deletion removes the marker and may permit migration again. Migration never assigns a global draft to a resumed session or acknowledges/replays submissions.

Runtime Save validates nonempty single-line executable names/paths; actual existence is checked on launch. Dirty Runtime fields survive page/category navigation, not restart. External committed values update next launch while dirty fields retain their text and an explicit overwrite notice. Save failure retains prior committed paths.

Geometry is project scoped: cache normal physical placement/size/maximized state and save on orderly close/quit, not every drag. Bound restoration and missing-display fallback. Predefined AppKit Quit bypasses cancellable exit, so macOS Quit/⌘Q must stay app-owned through save and observed shutdown. Final-exit fallback flushes cached geometry synchronously without querying terminating windows. Abrupt death can lose recent geometry.

## Tests and platform pitfalls

`test/preferences.test.ts`, `test/settings.test.ts`, `test/shell.test.ts` and native preferences/window-state tests cover JSONC preservation, migration, external changes, revision order, conflict/failure, dirty fields, startup focus and scoped geometry validation. No-op fixtures additionally cover queued/committed equality, A → B → A and mixed explicit/conditional requests, caller mutation, failed-write recovery, external edit/deletion invalidation, and native file-byte/revision preservation with malformed-file validation intact. A bundled shell regression feeds 200 foreground/background streaming deltas without state IPC while preserving output, draft/focus, selection persistence and rename persistence. These fixtures establish avoided work, not native responsiveness improvement under CPU contention. Subsequent user feedback and supplied packaged macOS reports show limited observed recovery under reported load; [verification](verification.md#performance-observation) owns that evidence and its attribution limits. Browser Settings sync/layout fixtures cover real HTML modality and unchanged conversation state; [Settings layout](settings-layout.md) maps them.

Multi-display/DPI placement, native macOS Quit/clipboard/file chooser behavior and Linux/possible Windows acceptance are not established by unit/jsdom tests. Run `mise run check` and relevant offline browser tests; build only on request. Historical optional Chromium checks are in [settings history](history/settings-migration.md).
