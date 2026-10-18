# Settings

**Global Settings** opens in its own reusable window through **⌘/Ctrl+,**, the native **Settings…** menu item, or the command palette. It contains Appearance, Notifications, Diagnostics, Keybindings and Runtime. On first open, the window appears after its controls, theme, translucency and zoom are prepared, instead of showing a blank opaque page while loading. Runtime-path detection can continue afterward. Opening it again focuses the existing ready window; Close or Escape closes that window. No project is required.

**Project settings** opens inside the current project window through the Project bar's gear, **⌘/Ctrl+Shift+,**, or the command palette. The header names the project. **Back** or **Escape** returns to its conversation; **Open global settings** opens the separate defaults window.

Pi keeps running. Project settings preserves your draft, conversation and reading position and restores prior focus when available. Pi extension dialogs retain priority. Global Settings does not launch, resume, stop or restart agents.

## Global defaults and project overrides

Project settings shows effective values, not a second independent configuration. **Global default** means the project follows the global value (or the built-in default/runtime discovery when omitted globally). Changing a control creates a **Project override**. **Use global default** removes that override and immediately follows the current global value again—it does not copy that value into the project file.

Overrides stay explicit even if they match the global value. Global edits update inheriting projects, but never replace explicit project values. The Appearance pane in global Settings links to open projects with overrides.

Project overrides cover **theme and Pi/Node runtime paths** only. **Translucency, zoom, modal animations and auto-follow after sending are global-only**, along with notifications, diagnostics, keybindings, imported-theme storage and card-plugin configuration. Project settings contains only the theme picker under Appearance and runtime paths under Runtime. The project theme picker uses the shared global theme library; import and removal happen in global Settings.

This layering applies only to Nimrod preferences. Pi retains its own configuration and precedence.

## Categories and width

Category selection, unsaved Runtime fields and each category's reading position survive navigation and reopening Project settings in the same window, not app restart. In global Settings, these values and Keybindings search survive category changes while the Settings window remains open. **Edit keybindings…** in the command palette opens global Settings at Keybindings and focuses search; it has no default shortcut.

Use Up/Down in the category sidebar to cycle categories, Home/End for first/last, and Tab to enter the pane.

Drag the sidebar's right edge to resize it. Its width is saved app-wide, separately from project Session sidebar widths. With the handle focused, Left/Right adjust by 10px (Shift: 50px), Home/End choose current limits, and double-click restores the default. Narrow windows temporarily cap the width without overwriting your preference.

Escape during a drag cancels resizing; the next Escape closes Settings.

## Appearance

- **Theme:** global changes update inheriting windows; project changes apply only to that project. See [Themes](themes.md) for live previews, bundled themes and imports.
- **Translucency (global only):** background opacity (default **100% / Opaque**), **Whole window / Sidebar and Project bar**, and a macOS-only **Background blur** slider (0–40, default **20**) independent of opacity. Linux blur is configured in the desktop compositor. See [Translucency](translucency.md) for preview, accessibility and platform limitations.
- **Zoom (global only):** scales every project, Settings and reference window, default **125%**, range **75–200%**. Use the picker in global Settings or **⌘/Ctrl + / −** in a project window; shortcuts change the same global value. **⌘/Ctrl+0** resets to 100%. Zoom is remembered and doesn't change drafts.
- **Modal animation (global only):** **Subtle** (default) gives the command palette and ordinary dialogs a short fade, tiny upward movement and gentle scale. **CRT power-on** starts as a glowing, theme-accent two-pixel horizontal line, with untinted content revealed up and down from the center; closing collapses it back to a line. **Hologram** reveals the panel from top to bottom behind a glowing theme-accent scan line with a soft trail; closing scans back upward without fading the panel. The scan line and reveal share a start time, and the line remains visible across the full scan; there is no flicker or continuous animation. Select an animated style to show a **Duration (milliseconds)** slider with a live readout: default **500 ms for Subtle** or **300 ms for CRT/Hologram**, range **100–1500 ms** in **10 ms steps**. Drag to adjust or use the slider's keyboard controls; changes save when committed/released, not on every drag frame. These defaults apply when no duration is saved; an explicit duration is shared when switching styles. Older values are clamped to the range and rounded to 10 ms in memory, without rewriting your settings file; the next slider adjustment saves its in-range value. Choose **None** for instant transitions. **CRT closing reverses the opening motion without fading the panel and takes 20% less time** (**400 ms** at a **500 ms** setting). It collapses to the accent line, holds briefly, then disappears; only the backdrop fades. Hologram closing also takes 20% less time. **Subtle** dismissal remains 25% faster. All styles apply to ordinary dialogs and the palette, including native dialogs. A non-interactive visual copy animates after the real dialog closes, so focus and underlying controls are already available. Opening another dialog removes any old closing animation. **None** hides the options and disables motion without forgetting your duration. **Preview animation** opens a sample dialog; both its Close button and Escape play the same closing motion as ordinary dialogs and return to Settings. System reduced-motion preferences disable motion regardless of the saved style. Input and focus do not wait for animations. Full-window Settings, native windows and transcript disclosures are unaffected; changing picker pages does not reopen/animate the shell. Duration is shared across styles and remembered when switching. To try Hologram, choose it here and click **Preview animation**; its default is **300 ms open / 240 ms close**. Existing explicit durations are preserved—move the slider to 300 ms if you previously saved 500 ms. Try **350–500 ms** for a more visible CRT effect.
- **Auto-follow after sending (global only):** **When idle** (default) jumps to the bottom and follows new output for idle sends, but preserves your position for steering and queued follow-ups. **Always** does this for every message submission; **Never** preserves current scroll intent, including auto-follow if already active. Scrolling upward always pauses following. Changes synchronize across all projects. Changes affect subsequent sends without moving your current view. See [Reading conversations](reading-conversations.md#auto-follow-and-reading-older-output).
- Theme/import/zoom errors use the shared [notice strip](error-messages.md). Non-error progress and import details stay alongside the controls.

## Notifications

**Background session alerts** are on by default. Turn them off across windows, send a fixed-content delivery test, or refresh read-only macOS diagnostics. See [Notifications](notifications.md) for triggers, click behavior and troubleshooting.

## Diagnostics

**Transcript debug logs** is off by default and replaces tool-only capture using the same existing switch. It records full native Pi/Copilot conversation events, prompts, responses/reasoning, tools, delivered history, configuration and requests/results in rotating JSONL files under Nimrod’s XDG state directory. Logs can contain secrets; nothing is uploaded. While logging, files rotate at 25 MiB and oldest logs are deleted to keep at most 250 MiB across sources and seven days since last modification. Existing opt-in values are retained; agent history and old tool-only files stay untouched. See [Transcript debug logs](tool-capture.md).

**Performance diagnostics** are off by default. Enable timing-only in-memory history in global Settings, then choose **Capture performance report** in the affected project window’s command palette when typing or scrolling feels slow. Capture can also be bound to a shortcut. The project window’s notice strip shows capture progress and the saved path; the command’s detail also retains that path. See [Performance reports](performance-diagnostics.md) for privacy, local storage and limitations.

## Keybindings

Search actions, record shortcuts, resolve conflicts explicitly, remove bindings or reset defaults. Saved changes synchronize across project windows without changing running sessions. See [Keybindings](keybindings.md).

## Runtime

Pi and Node paths are discovered automatically; override them here if needed.

1. Wait for initial detection.
2. Edit executable names or paths.
3. Click **Save runtime paths**, or press Enter in the form. In Project settings, only edited fields become overrides; untouched fields keep inheriting.
4. Start a new session to use the saved paths.

Saving never changes an already-running process. Unsaved fields survive navigation in this window, not restart, and aren't used for launch. External settings edits update saved launch paths without replacing dirty fields; Save then replaces those corresponding values. Invalid/failed saves retain the prior saved paths.

On Windows, choose Pi's JS entry point and `node.exe` explicitly; npm `.cmd` wrappers aren't supported. Models and thinking levels are [live session controls](model-thinking.md), not app preferences.

## Configuration files

Resolved paths appear under Runtime. Defaults are:

```text
<project>/.nimrod/settings.json   # Optional project overrides (JSONC)
~/.config/nimrod/settings.json     # Global defaults (JSONC)
~/.local/state/nimrod/state.json   # App-managed bookkeeping
~/.local/state/nimrod/drafts/      # Native per-session draft records
~/.local/state/nimrod/popouts/     # Saved reference snapshots
```

Absolute `XDG_CONFIG_HOME` and `XDG_STATE_HOME` override the roots. Empty/relative overrides fall back to home defaults. Windows uses the user's home directory, normally `%USERPROFILE%`.

The global `settings.json` accepts comments and trailing commas:

```jsonc
{
  "appearance.theme": "nimrod",
  "appearance.zoom": 125,
  "appearance.backgroundOpacity": 100,
  "appearance.backgroundBlur": 20,
  "appearance.translucencyArea": "window",
  "appearance.autoFollowAfterSending": "whenIdle",
  "appearance.modalAnimation": "subtle",
  "appearance.modalAnimationDuration": 500,
  "notifications.enabled": true,
  "runtime.piPath": "/path/to/pi",
  "runtime.nodePath": "/path/to/node",
  "runtime.copilotPath": "/path/to/copilot"
}
```

Personal [card plugins](card-plugins.md#personal-typescript-plugins) are discovered/compiled automatically from the dedicated user directory; `cards.autoLoad: false` disables this directory-trusted workflow. Existing manifests use `cards.plugins` / `cards.trustedPlugins`; `cards.renderers` overrides tool matching. Declarative manifests need no executable trust. They are configured in this file, not a dedicated Settings category. Package load errors use the shared notice strip, including while Settings is open; catalog changes affect newly mounted cards without restarting agents.

The project file applies only `appearance.theme`, `runtime.piPath`, `runtime.nodePath`, and `runtime.copilotPath`. Earlier project entries for `appearance.zoom` and `appearance.autoFollowAfterSending` are ignored; their bytes/comments are preserved on unrelated saves, never copied into global preferences, and you can remove those obsolete entries manually. Other unsupported project keys still report a configuration error. Nimrod creates it only on an explicit override save, not when opening a project or Settings. There is no ancestor-directory discovery: the canonical project directory is the only project scope. You can choose whether to version-control `.nimrod/settings.json`; imported theme IDs refer to your global theme library.

Omitted project keys inherit global settings; omitted global keys use defaults or runtime discovery. Imported themes live in `appearance.importedThemes`; [keybinding overrides](keybindings.md#configuration-file) live in `keybindings`. Pi's settings remain Pi-owned. [Drafts](drafts.md) use separate Rust-managed per-session files with debounced asynchronous saves; legacy webview drafts are ignored without migration.

Valid external edits update open windows. Invalid files keep the last valid values and show an error in the shared notice strip; correcting the file clears it. UI saves preserve comments and unrelated keys, refuse malformed files and report detected conflicts rather than silently retrying. External editors aren't locked.

Removing a project settings file returns that project to global defaults. Removing global settings resets global defaults without removing project overrides. Removing state clears remembered disk bookkeeping without closing live sessions and can allow legacy migration again on next startup. Existing configuration takes precedence during legacy migration; source data is retained.

Window size, placement and maximized state are saved per project on orderly close/quit. Missing-display fallback is supported, but abrupt termination can lose recent geometry and native multi-display/DPI behavior remains unverified.

Ancestor-directory discovery and cloud sync are not implemented. Native acceptance of the separate Settings window, shortcuts and multi-window behavior still needs verification on macOS; Linux behavior remains unverified.
