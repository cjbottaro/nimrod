# Settings

Open **Settings** using the gear button in the project bar or **⌘/Ctrl ,**. Use **Back** or **Escape** to return. Opening Settings again while already there leaves the current control alone.

Settings is a separate, full-window page. Its content follows the window width with modest 20 CSS-pixel side gutters; the entire body, including those gutters, scrolls. The Back header stays visible. Internally it uses a full-viewport native HTML dialog: the project remains mounted and laid out underneath, while browser modality makes it non-interactive and removes it from the active accessibility surface. This avoids collapsing the transcript pane or resetting scroll/disclosure state.

Pi keeps running and the transcript continues receiving events. Opening, closing, or saving preferences never starts/stops/restarts a session or submits a prompt. Returning restores the prior focus target when available. If startup hid that original control, focus falls back to the Settings button. Existing RPC dialogs retain priority; Settings won't open over or close underneath an active Pi dialog.

## Files and synchronization

Nimrod uses the same home-directory/XDG-style layout on macOS, Linux, and Windows:

```text
~/.config/nimrod/settings.json     # User-editable JSONC preferences
~/.local/state/nimrod/state.json   # App-managed UI/session bookkeeping
~/.local/state/nimrod/popouts/     # One Nimrod-owned JSON snapshot per saved pop-out
```

Absolute `XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the corresponding roots. Empty or relative overrides fall back to the home-directory defaults. Windows uses the user's home directory (normally `%USERPROFILE%`), not the registry or an AppData-only convention. The resolved paths appear on the Settings page.

`settings.json` accepts comments and trailing commas:

```jsonc
{
  "appearance.theme": "nimrod", // Or "dracula" / an imported theme ID
  "appearance.zoom": 125,
  "notifications.enabled": true,
  "runtime.piPath": "/path/to/pi",
  "runtime.nodePath": "/path/to/node"
}
```

Omitted keys use built-in defaults or runtime discovery. Imported color palettes are kept in `appearance.importedThemes`; the theme picker manages this array. Pi's configuration remains entirely Pi-owned.

The Rust host polls both files every **500 ms**, detecting normal saves, atomic file replacement, and deletion. Valid external changes update open windows and their Settings controls without replacing conversation DOM or restarting agents. Invalid files keep the last valid values (defaults on a fresh launch), flag the Settings gear, and show the error on the Settings page. Correcting the file clears the error. Removing settings resets preferences to defaults; removing state clears remembered bookkeeping on disk without closing live sessions.

UI saves preserve comments and unrelated settings, use same-directory temporary-file replacement, and preserve existing dotfile symlinks. Native writes serialize across windows; settings edits compare the source text immediately before writing and report conflicts rather than silently retrying. External editors aren't locked: an external write racing between that check and replacement is not excluded. Malformed files are never overwritten by UI saves.

On first use, valid legacy webview preferences, imported themes, recent projects, remembered open-session layouts, sidebar visibility, and the global last-session pointer are copied into the files. Existing configuration takes precedence, migration is marked in the versioned state file, and legacy sources are retained. Deleting state also deletes that marker, allowing legacy migration again at the next startup. **Drafts and uncertain submissions stay in their existing scoped webview storage**; this change does not migrate or replay them.

Window size, placement, and maximized state are app-managed and project-scoped. Normal geometry is remembered in memory and saved on orderly window close/app quit, not on every drag. On macOS, the Quit menu and ⌘Q use Nimrod's save/shutdown handler instead of AppKit's direct termination action. A final-exit fallback flushes event-cached geometry for termination paths that bypass the cancellable exit request, without querying windows after termination starts. Restoration bounds dimensions and repositions windows whose display disappeared. Abrupt process death can lose the latest geometry. Native multi-display/DPI/platform acceptance remains unverified.

[Pop-outs](pop-outs.md) store captured content under the state root's `popouts/`, with references and window geometry in app-managed state—not preferences or Pi files.

Project settings and personal project overrides are not implemented yet. There is no ancestor-directory discovery.

## Appearance

- **Color theme:** existing Nimrod/Dracula picker, import, and removal actions. Changes apply immediately and are saved. See [themes.md](themes.md).
- **Zoom:** whole-app zoom, default 125%, with the existing saved preference. **⌘/Ctrl + / − / 0** are the customizable defaults. Zoom shortcuts work on this page and in the project, but pause through other dialogs.
- Theme/import/zoom notices are shown alongside their controls in Settings.

Existing theme and zoom choices are migrated into the file-backed preferences. Restoring zoom does not rewrite the settings file.

## Notifications

**Background session alerts** are on by default. The On/Off picker saves immediately and synchronizes across windows without changing running sessions. **Send test notification** checks the native delivery path without starting an agent; it is disabled while alerts are off. The status line shows the latest attempt/suppression/error plus macOS policy and foreground-handler diagnostics after a test. **Refresh notification diagnostics** is read-only and remains available with alerts off; it neither posts a notification nor requests permission. macOS authorization and submission errors also appear in the project error area; OS notification settings still apply. See [notifications](notifications.md) for triggers, focus suppression, privacy and current native limitations.

## Keybindings

Search Nimrod actions, record shortcuts, remove bindings, or restore defaults per action/all actions. Conflicts require explicit reassignment, and saved changes synchronize across project windows without touching running sessions. See [Keybindings](keybindings.md) for defaults, reset semantics and configuration syntax. Composer delivery and Pi’s internal keymap are unchanged.

## Runtime

Pi and Node executable paths now live here instead of the launch form.

- Wait for initial runtime detection before editing; delayed startup must not overwrite an editable field.
- Edit the paths and click **Save runtime paths** (or submit the runtime form with Enter).
- Save validates non-empty, single-line executable names/paths and persists them locally. Actual executable existence is validated by the Rust host when starting the next session.
- The next launch uses a snapshot of the **saved** paths. Editing or saving them cannot change the configuration of the already running process.
- Unsaved field edits remain when leaving/reopening Settings but are not used for launching and do not survive app restart. External file edits update the committed launch paths without replacing dirty fields; a notice explains that Save will replace those corresponding saved paths.
- Persistence/validation failures keep the previously committed paths available and show the error without changing sessions.
- Existing `nimrod.runtime.v1` / old launch preferences are migration sources only. Runtime paths now live under `runtime.piPath` and `runtime.nodePath` in `settings.json`.

Project-folder selection and explicit new saved / temporary actions stay on the launch screen; **Resume session…** searches saved project history through the command palette. There is no arbitrary session-file chooser or demo launch action. Resume last session restores its remembered file/project pair only on an explicit click, never automatically at startup. Pi owns conversation persistence; per-session drafts and the last-session pointer are separate from application preferences. Model and thinking-level controls stay in the session's status area: those are live session controls, not application preferences.

## Implementation and verification

- `index.html` / `src/theme.css`: full-page Settings surface, grouped Appearance/Notifications/Runtime controls, minimal project-bar gear.
- `src/settings.ts`: navigation/shortcut handling and the explicit runtime Save boundary.
- `src/preferences.ts`: JSONC edits, legacy migration, revision-ordered synchronization, and native persistence bridge.
- `src-tauri/src/preferences.rs`: XDG paths, serialized/atomic writes, file polling, last-valid snapshots, and conflict checks.
- `src-tauri/src/window_state.rs`: project-scoped native geometry capture/restoration.
- `src/main.ts`: preference initialization, next-launch snapshot, and startup focus guard.
- `test/preferences.test.ts`, native preferences tests, `test/settings.test.ts` / `test/shell.test.ts`: JSONC preservation, migration, external edits, stale revisions, conflicts/failures, dirty-field retention, startup focus, and renderer updates behind Settings. Native geometry tests check scope/validation, not actual window placement.
- `scripts/check-settings.mjs`: optional local Chromium dialog/layout check, including background focus containment, focus restoration, retained geometry/scroll/draft/disclosure/spinner identity, nested dialogs, and saved runtime snapshots. Uses controlled animation-frame scheduling; does not establish native animation timing or WebKit acceptance.

```sh
CHROMIUM=/path/to/chrome-headless-shell node scripts/check-settings.mjs
```

This replaces the earlier project-bar theme/zoom pickers and launch-form runtime fields. It does not implement the [deferred theme catalog](theme-catalog-plan.md).
