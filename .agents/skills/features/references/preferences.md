# Preferences, bookkeeping and window state

**Status: implemented.** User guide: [Settings](../../../../docs/settings.md). Related: [Settings layout](settings-layout.md), [drafts/session storage](projects-and-sessions.md#ownership-discovery-and-persistence), [build workflow](build-cache.md).

## Specification and acceptance criteria

`runtime.copilotPath` is a global/project Runtime executable preference beside
Pi/Node; fallback is `copilot`. Native and TypeScript project-key validation,
provenance/reset, explicit Save and future-launch snapshots include it. It never
changes an active session or stores authentication. The bundled SDK is pinned
by the application, never selected by a user-installed SDK path.

Separate user-editable JSONC settings from app-managed state and session-local drafts. Preferences synchronize across windows without recreating conversations, restarting agents, settling submissions or replaying prompts. Runtime edits require explicit Save and affect a future launch snapshot only.

Missing keys use defaults; malformed external files retain the last valid snapshot (defaults on fresh launch), flag the gear and expose errors. Correcting a file clears the error. UI saves preserve comments/unrelated keys and reject malformed/conflicting source, not silently retry.

## Code map

- `src/preferences.ts`: JSONC patches, validation, legacy migration, revision ordering, pending state-write comparison and native bridge. Global-only `diagnostics.toolCapture` defaults false and retains its compatibility name; [transcript debug logging](tool-capture.md) owns the full-content Pi/SDK/ACP logging contract.
- `src/settings.ts`: Runtime per-field dirty state, explicit Save, page modality and focus.
- `src/settings-surface.ts`, `src/global-settings.ts`, `src-tauri/src/settings_window.rs`: shared scoped controls, isolated global Settings boot and singleton native window.
- `src/settings-navigation.ts`, `src/sidebar-resize.ts`: layout-only policies; [Settings layout](settings-layout.md) owns these contracts.
- `src/main.ts`: boot initialization, committed next-launch preferences and focus guards.
- `src-tauri/src/preferences.rs`: XDG paths, polling, serialized same-directory replacement and broadcasts.
- `src-tauri/src/window_state.rs`, `native_menu.rs`: geometry capture/restore and app-owned macOS Quit.
- `index.html`, `src/theme.css`, `src/workspace.css`: mounted page surfaces and error presentation.

## Project layering

Effective Nimrod preferences are built-in defaults → global JSONC → canonical-project JSONC; Pi configuration remains Pi-owned and unmodified. The optional project file is `<canonical cwd>/.nimrod/settings.json`, created only by an explicit override write. No ancestor discovery or automatic project-file migration. Keys applied at project scope: `appearance.theme`, `runtime.piPath`, `runtime.nodePath`. [Window translucency](translucency.md), zoom and send auto-follow are global-only: getters read the validated global layer and saves always target the global JSONC file, including zoom shortcuts invoked from project windows. Earlier project entries `appearance.zoom` and `appearance.autoFollowAfterSending` are tolerated but excluded before merged validation/provenance projection—even obsolete values cannot affect effective settings. Keep their raw source/comments for CAS and unrelated JSONC edits; do not automatically rewrite files or promote a project's former value into the global file. Global Settings's project-override list filters these ignored entries as well. Other unsupported global-only keys are rejected in project files; imported palettes remain in the global library.

`src-tauri/src/project_preferences.rs` validates project files against global configuration, uses the existing bounded JSONC reader/symlink-preserving atomic writer and CAS rules, and derives every file path from native window ownership (not frontend-provided paths). Independent project revisions reject late snapshots; watcher fingerprints include project revision/membership, so external edits first observed by scoped reads cannot suppress later broadcasts; native polling invalidates all windows, each of which fetches only its owned scope through `src/native-preferences.ts`. Invalid project files retain the last valid override document and report a project-path error; UI writes do not overwrite malformed sources. Invalid effective snapshots retain the frontend's last valid effective settings. Global and project deletion reset their own layer only. Project watcher entries retire when their owning window closes. No UI file creation, harness RPC, process restarts or transcript reconstruction during preference synchronization.

`src/preferences.ts` preserves presence as provenance: equal-valued explicit overrides remain overrides. `useGlobal` deletes a JSONC key, never copies a global value. Runtime Save creates overrides only for edited fields; untouched fields continue inheriting. Runtime reload updates untouched fields independently while preserving dirty fields and authoritative launch defaults; Save consumes its authoritative effective-path result so an inherited field changing during the write cannot be replaced by a stale form snapshot. Override reset likewise preserves newer per-field edits made while its write was pending; reset-button focus returns to the corresponding control only when focus is vacant and the owning pane is still active. Project theme selection uses the global library without copying imports; import/remove controls are global-only. Removing an imported palette still referenced by a project can make that project's configuration invalid; Use global default removes the now-invalid theme override safely when its unchanged JSONC source still matches the expected bytes. Restore the palette or correct the project file explicitly for other invalid sources; malformed/changed disk files are never overwritten by this recovery path.

## Storage and synchronization

Defaults: `~/.config/nimrod/settings.json`, `~/.local/state/nimrod/state.json`, and saved snapshots in `~/.local/state/nimrod/popouts/`. Absolute XDG roots override on all platforms; empty/relative overrides fall back to home. Windows uses the user's home, not a registry/AppData-only layout.

The separate personal plugin bundle cache uses absolute `XDG_CACHE_HOME` or `~/.cache/nimrod/card-plugins/`; it is disposable compiled data, not settings, state, drafts or Pi history. Personal source placement grants directory trust; `cards.autoLoad` is a validated boolean escape hatch. Legacy per-manifest trust remains independent.

Global-only modal motion uses `appearance.modalAnimation` (`none | subtle | crt | hologram`, default `subtle`) and `appearance.modalAnimationDuration` (integer 0–2000 milliseconds; absent key defaults to 500 for Subtle/Hologram or 300 for CRT, while explicit values remain shared and unchanged). [Modal layout](modal-layout.md#modal-motion) owns presentation, accessibility and option behavior. Frontend/native validation and queued global JSONC saves preserve existing synchronization/CAS rules; these keys are rejected at project scope.

Settings include appearance (including global-only [window translucency](translucency.md) and the [send auto-follow mode](transcript-interaction.md#auto-follow-after-sending), default `whenIdle`), notification boolean, [performance-diagnostics opt-in](performance-diagnostics.md), runtime paths, keybinding overrides and [card-plugin autoload/legacy manifests/trust/renderer overrides](card-plugins.md#current-code-and-preserved-evidence). Feature references own their schemas. State includes project/session layout, recency, last-session pointer, widths, command history, geometry, pop-out references and deletion guards. [Editable draft records](native-drafts.md) are scoped Rust-managed files with debounced asynchronous disk saves and no legacy-draft migration; image bytes are separate IndexedDB, temporary bytes memory-only. See [image paste](image-paste.md).

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

Global-only regressions in preferences/native project fixtures, shell and `test/browser/settings-scopes.spec.ts` cover legacy ignored entries/comment preservation, global reads/writes from project contexts, hidden project controls, synchronized global controls, valid theme/runtime overrides and reader/session preservation. Added/updated without running tests/checks/builds; native acceptance remains pending.

New project-layer fixtures in `test/preferences.test.ts` and `src-tauri/src/project_preferences.rs` cover inheritance, equal-valued overrides, reset-by-deletion, global-only writes, per-project revisions, imported-library selection, malformed files/deletion and CAS refusal. Authored for this change; no tests/checks/builds or native acceptance were run unless separately requested.

`test/preferences.test.ts`, `test/settings.test.ts`, `test/shell.test.ts` and native preferences/window-state tests cover JSONC preservation, migration, external changes, revision order, conflict/failure, dirty fields, startup focus and scoped geometry validation. No-op fixtures additionally cover queued/committed equality, A → B → A and mixed explicit/conditional requests, caller mutation, failed-write recovery, external edit/deletion invalidation, and native file-byte/revision preservation with malformed-file validation intact. A bundled shell regression feeds 200 foreground/background streaming deltas without state IPC while preserving output, draft/focus, selection persistence and rename persistence. These fixtures establish avoided work, not native responsiveness improvement under CPU contention. Subsequent user feedback and supplied packaged macOS reports show limited observed recovery under reported load; [verification](verification.md#performance-observation) owns that evidence and its attribution limits. Browser Settings sync/layout fixtures cover real HTML modality and unchanged conversation state; [Settings layout](settings-layout.md) maps them.

Multi-display/DPI placement, native macOS Quit/clipboard/file chooser behavior and Linux/possible Windows acceptance are not established by unit/jsdom tests. Run `mise run test` and relevant offline browser tests; build only on request. Historical optional Chromium checks are in [settings history](history/settings-migration.md).
