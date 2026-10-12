# Settings

Open the Project bar's gear or **⌘/Ctrl+,**. Choose Appearance, Notifications, Keybindings or Runtime in the category sidebar. **Back** or **Escape** returns to your project.

Pi keeps running while Settings is open. Returning preserves your draft, conversation and reading position and restores prior focus when available. Pi extension dialogs retain priority.

## Categories and width

Category selection, unsaved Runtime fields, Keybindings search and each category's reading position survive navigation and reopening Settings in the same window, not app restart. **Edit keybindings…** / **⌘/Ctrl+Shift+,** opens Keybindings and focuses search.

Use Up/Down in the category sidebar to cycle categories, Home/End for first/last, and Tab to enter the pane.

Drag the sidebar's right edge to resize it. Its width is saved app-wide, separately from project Session sidebar widths. With the handle focused, Left/Right adjust by 10px (Shift: 50px), Home/End choose current limits, and double-click restores the default. Narrow windows temporarily cap the width without overwriting your preference.

Escape during a drag cancels resizing; the next Escape closes Settings.

## Appearance

- **Theme:** changes apply immediately and synchronize across windows. See [Themes](themes.md) for live previews, bundled themes and imports.
- **Zoom:** scales the whole app, default **125%**, range **75–200%**. Use the picker or **⌘/Ctrl + / −**; **⌘/Ctrl+0** resets to 100%. Zoom is remembered and doesn't change drafts.
- Theme/import/zoom errors appear alongside the controls.

## Notifications

**Background session alerts** are on by default. Turn them off across windows, send a fixed-content delivery test, or refresh read-only macOS diagnostics. See [Notifications](notifications.md) for triggers, click behavior and troubleshooting.

## Keybindings

Search actions, record shortcuts, resolve conflicts explicitly, remove bindings or reset defaults. Saved changes synchronize across project windows without changing running sessions. See [Keybindings](keybindings.md).

## Runtime

Pi and Node paths are discovered automatically; override them here if needed.

1. Wait for initial detection.
2. Edit executable names or paths.
3. Click **Save runtime paths**, or press Enter in the form.
4. Start a new session to use the saved paths.

Saving never changes an already-running process. Unsaved fields survive navigation in this window, not restart, and aren't used for launch. External settings edits update saved launch paths without replacing dirty fields; Save then replaces those corresponding values. Invalid/failed saves retain the prior saved paths.

On Windows, choose Pi's JS entry point and `node.exe` explicitly; npm `.cmd` wrappers aren't supported. Models and thinking levels are [live session controls](model-thinking.md), not app preferences.

## Configuration files

Resolved paths appear under Runtime. Defaults are:

```text
~/.config/nimrod/settings.json     # User-editable JSONC preferences
~/.local/state/nimrod/state.json   # App-managed bookkeeping
~/.local/state/nimrod/drafts/      # Native per-session draft records
~/.local/state/nimrod/popouts/     # Saved reference snapshots
```

Absolute `XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the roots. Empty/relative overrides fall back to home defaults. Windows uses the user's home directory, normally `%USERPROFILE%`.

`settings.json` accepts comments and trailing commas:

```jsonc
{
  "appearance.theme": "nimrod",
  "appearance.zoom": 125,
  "notifications.enabled": true,
  "runtime.piPath": "/path/to/pi",
  "runtime.nodePath": "/path/to/node"
}
```

Local [card plugins](card-plugins.md#install-an-executable-plugin) use `cards.plugins` (ordered manifests), `cards.trustedPlugins` (explicit executable-code trust) and `cards.renderers` (tool-to-renderer overrides). Declarative packages need no executable trust. They are configured in this file, not a dedicated Settings category. Package load errors appear in Settings; catalog changes affect newly mounted cards without restarting agents.

Omitted keys use defaults or runtime discovery. Imported themes live in `appearance.importedThemes`; [keybinding overrides](keybindings.md#configuration-file) live in `keybindings`. Pi's settings remain Pi-owned. [Drafts](drafts.md) use separate Rust-managed per-session files with debounced asynchronous saves; legacy webview drafts are ignored without migration.

Valid external edits update open windows. Invalid files keep the last valid values and show an error; correcting the file clears it. UI saves preserve comments and unrelated keys, refuse malformed files and report detected conflicts rather than silently retrying. External editors aren't locked.

Removing settings resets preferences. Removing state clears remembered disk bookkeeping without closing live sessions and can allow legacy migration again on next startup. Existing configuration takes precedence during legacy migration; source data is retained.

Window size, placement and maximized state are saved per project on orderly close/quit. Missing-display fallback is supported, but abrupt termination can lose recent geometry and native multi-display/DPI behavior remains unverified.

Project-specific settings/ancestor-directory discovery and cloud sync are not implemented.
