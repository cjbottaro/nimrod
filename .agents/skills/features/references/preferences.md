# Preferences, bookkeeping and window state

**Status: implemented.** User guide: [Settings](../../../../docs/settings.md). Related: [Settings layout](settings-layout.md), [drafts/session storage](projects-and-sessions.md#ownership-discovery-and-persistence), [build workflow](build-cache.md).

## Specification and acceptance criteria

Separate user-editable JSONC settings from app-managed state and session-local drafts. Preferences synchronize across windows without recreating conversations, restarting agents, settling submissions or replaying prompts. Runtime edits require explicit Save and affect a future launch snapshot only.

Missing keys use defaults; malformed external files retain the last valid snapshot (defaults on fresh launch), flag the gear and expose errors. Correcting a file clears the error. UI saves preserve comments/unrelated keys and reject malformed/conflicting source, not silently retry.

## Code map

- `src/preferences.ts`: JSONC patches, validation, legacy migration, revision ordering and native bridge.
- `src/settings.ts`: Runtime dirty fields, explicit Save, page modality and focus.
- `src/settings-navigation.ts`, `src/sidebar-resize.ts`: layout-only policies; [Settings layout](settings-layout.md) owns these contracts.
- `src/main.ts`: boot initialization, committed next-launch preferences and focus guards.
- `src-tauri/src/preferences.rs`: XDG paths, polling, serialized same-directory replacement and broadcasts.
- `src-tauri/src/window_state.rs`, `native_menu.rs`: geometry capture/restore and app-owned macOS Quit.
- `index.html`, `src/theme.css`, `src/workspace.css`: mounted page surfaces and error presentation.

## Storage and synchronization

Defaults: `~/.config/nimrod/settings.json`, `~/.local/state/nimrod/state.json`, and saved snapshots in `~/.local/state/nimrod/popouts/`. Absolute XDG roots override on all platforms; empty/relative overrides fall back to home. Windows uses the user's home, not a registry/AppData-only layout.

Settings include appearance, notification boolean, runtime paths, keybinding overrides and [card-plugin manifests/executable trust/renderer overrides](card-plugins.md#current-code-and-preserved-evidence). Feature references own their schemas. State includes project/session layout, recency, last-session pointer, widths, command history, geometry, pop-out references and deletion guards. [Draft records/uncertainty](native-drafts.md) are scoped Rust-managed files with debounced asynchronous disk saves and no legacy-draft migration; image bytes are separate IndexedDB, temporary bytes memory-only. See [image paste](image-paste.md).

Each preferences/state file retains its 8 MiB cap; saved pop-out content stays in separate bounded files, never embedded in global state.

Rust polls both files every 500 ms, recognizing regular edits, atomic replacement and deletion. Revision-ordered broadcasts reject stale snapshots. Settings deletion resets defaults; state deletion clears remembered disk bookkeeping without closing live sessions. Already-mounted project layouts aren't rebuilt from state broadcasts; Settings width and applicable preferences synchronize explicitly.

Writes serialize natively, preserve dotfile symlinks, compare settings source text immediately before replacement and use same-directory temporary files. Detected CAS conflicts are visible and never retried. External editors remain unlocked; the final check/replacement race is not excluded.

## Migration and lifecycle

Valid legacy theme/runtime/layout/recents/sidebar/last-session state migrates once, marked in versioned state. Existing configuration wins and sources are retained. State deletion removes the marker and may permit migration again. Migration never assigns a global draft to a resumed session or acknowledges/replays submissions.

Runtime Save validates nonempty single-line executable names/paths; actual existence is checked on launch. Dirty Runtime fields survive page/category navigation, not restart. External committed values update next launch while dirty fields retain their text and an explicit overwrite notice. Save failure retains prior committed paths.

Geometry is project scoped: cache normal physical placement/size/maximized state and save on orderly close/quit, not every drag. Bound restoration and missing-display fallback. Predefined AppKit Quit bypasses cancellable exit, so macOS Quit/⌘Q must stay app-owned through save and observed shutdown. Final-exit fallback flushes cached geometry synchronously without querying terminating windows. Abrupt death can lose recent geometry.

## Tests and platform pitfalls

`test/preferences.test.ts`, `test/settings.test.ts`, `test/shell.test.ts` and native preferences/window-state tests cover JSONC preservation, migration, external changes, revision order, conflict/failure, dirty fields, startup focus and scoped geometry validation. Browser Settings sync/layout fixtures cover real HTML modality and unchanged conversation state; [Settings layout](settings-layout.md) maps them.

Multi-display/DPI placement, native macOS Quit/clipboard/file chooser behavior and Linux/possible Windows acceptance are not established by unit/jsdom tests. Run `mise run check` and relevant offline browser tests; build only on request. Historical optional Chromium checks are in [settings history](history/settings-migration.md).
