# Customizable keybindings

Human guide: [Keybindings](../../../../docs/keybindings.md).

## Code map

- `src/keybindings.ts`: action IDs/labels/scopes/default arrays, persisted grammar, layout-aware recorder/matcher, conflict/reassignment planning, capture-phase dispatcher.
- `src/keybinding-editor.ts` / `src/keybindings.css`: Settings section mounted before Runtime, searchable action list, nested recorder/reset confirmation, explicit reassign checkbox, notices and focus fallback.
- `src/main.ts`: registry dispatch to existing session/palette/settings/zoom methods, effective palette shortcut labels and sidebar/settings/zoom hints. Legacy module shortcuts are disabled here so rebinding cannot leave a second hard-coded listener active.
- `src/command-palette.ts`, `src/settings.ts`, `src/zoom.ts`: independently testable default listeners remain for standalone consumers; the shell passes `shortcuts: false` / `false`. Zoom exposes `run` for dispatch without synthetic keyboard events.
- `src/preferences.ts`: grammar validation, per-action JSONC writes against a fresh native snapshot, concurrent conflict review guard, empty-object Reset all, ordered synchronization.
- `src-tauri/src/keybindings.rs`: native persisted grammar/bounds. Keep in sync with the TS validator; defaults/actions remain TypeScript-owned, not duplicated in Rust.
- `src-tauri/src/preferences.rs`: delegates keybindings validation, preserving the existing native last-valid/atomic/CAS path.
- `src-tauri/src/native_menu.rs` / `main.rs`: custom accelerator-free Minimize/Close Window items; focused-window events use Tauri minimize/close, with normal window shutdown lifecycle. Quit/Open project stay native and reserved.

## Data and reset semantics

`settings.json` contains `keybindings: { [actionId]: string[] }`. No defaults are copied on startup/migration. Absence inherits defaults, `[]` intentionally unbinds, a list replaces the entire action's defaults. Multiple bindings are supported (max eight). Unknown syntactically valid IDs survive individual edits; no unknown action executes. Reset one removes its property; Reset all confirms and writes `{}` to avoid deleting comments preceding the settings property. Comments inside reset/removed overrides are naturally removed with them. Unrelated properties/comments survive.

The initial defaults are `primary+n` plus legacy `primary+t`, temporary `primary+shift+n`, deletion `primary+backspace`, model `primary+m`, effort `primary+e`, and existing palette/sidebar/session-cycle/settings/zoom keys. Blank-default actions in the registry include Resume, Switch, New named, Restart, Open session file, New offline demo and Edit keybindings. Action IDs intentionally align with the palette IDs.

## Invariants

- One capture-phase keyboard dispatcher in the project shell. It calls existing action methods; never sends a prompt or bypasses acknowledgement, deletion review, idle state, lifecycle guards or exact-file identity checks.
- Project bindings pause through every open modal, including native `dialog` and legacy `#dialog.open`. Only app-scope Settings/Zoom actions work through Settings alone. Recorder/extension/deletion/palette dialogs have priority over all bindings.
- IME (`isComposing`/229) and consumed events are ignored. Matching repeated/unavailable actions are consumed but never executed. This prevents held New/Delete shortcuts and prevents configured Cmd-Backspace from falling back to deleting draft text.
- Primary is platform-specific in real windows; empty-platform mock realms accept either Cmd or Ctrl for legacy fixtures. Explicit Cmd/Ctrl combinations remain exact. Plus/Equals share one normalized key, ignoring layout Shift; shifted bracket codes retain existing session-cycle behavior. Other keys use `event.key` (layout characters), not physical keycodes.
- Recorder input captures without execution and needs an explicit Save. Escape cancels, plain Tab navigates buttons. Unsupported/native editing/menu shortcuts are rejected. Plain text and Alt-only characters are not shell shortcuts; unmodified function keys are supported.
- Conflicts never silently choose a winner. UI offers explicit reassignment; manual duplicate active mappings consume the key and report an error without executing either action. Platform aliases are compared when planning reassignments.
- Reassignment is computed again against the freshly fetched native snapshot. If its affected-action patch differs from the reviewed patch or the target action changed, reject and require review. The editor also invalidates stale target editing and clears a Reassign approval when the displayed conflict list changes. Per-action edits preserve unrelated action changes; native source-text CAS handles later races without retry. Invalid external edits retain prior effective settings.
- Unrelated preference/state broadcasts do not redraw the keybinding list or disturb its focused control. Failed saves retain a visible recorder error as well as the Settings notice.
- Saving redraws rows; recorder close focuses the search instead of a detached row button, but never through a higher-priority modal. Settings remains modal over unchanged conversation DOM; no session start/stop is caused by preference changes.
- Native Minimize/Close Window are retained but no longer own Cmd-M/Cmd-W accelerators. Replacing predefined menu items is necessary because native handlers can intercept keys before webview dispatch. Native menus/text editing, OS reservations, composer delivery and reference-window Close remain outside this editor.

## Tests and remaining acceptance

- `test/keybindings.test.ts`: defaults, grammar, unbinding/reset, unknown IDs, Cmd/Ctrl/Shift/layout matching, IME/repeat/unavailable/modal priority, conflict reassign/reset, nested JSONC patches, stale/new conflicts, invalid external edits, recording/search/failure/focus.
- `test/shell.test.ts`: requested New/Temporary/Model/Effort defaults call the real shell methods against mocked native transport, retaining drafts and never prompting; rebinding disables old listeners; temporary deletion is unavailable; saved Cmd-Backspace opens review and Cancel retains state.
- `test/browser/keybindings.spec.ts`: isolated offline WebKit UI recording, conflict checkbox, unbinding/reset cancellation/confirmation, live effective dispatch, focus and retained session DOM/draft/tool disclosure. The browser fixture includes the keybinding stylesheet.
- Native validator tests cover defaults, future IDs, disabled bindings, reserved/malformed/duplicate shortcuts.

Validate with `mise run check`, `mise run build` (isolated target when a running artifact might otherwise be overwritten), and offline `npm run test:browser`. No live Pi/model requests or user-session deletion. Native shortcut interception/menu actions, non-US layouts, actual app focus and Linux/possible Windows behavior require user/platform acceptance; jsdom/WebKit fixtures do not prove these.

Latest combined-checkout verification: 326 TS/Node tests, 73 default Rust tests (two opt-in real-Pi smokes ignored), formatting/Clippy, 25 offline WebKit tests and signed isolated macOS build all pass. Artifact: `src-tauri/target/keybindings-check/release/bundle/macos/Nimrod.app`. No running app/default bundle modification or native acceptance was performed.

Deferred: composer Send/Steer/Queue/Newline remapping, Pi keymap integration, pop-out keyboard customization, chords/macros/context language, per-project preferences and native menu accelerator customization.
