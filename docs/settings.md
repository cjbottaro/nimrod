# Settings

**Global Settings** opens in its own reusable window through **⌘/Ctrl+,**, the native **Settings…** menu item, or the command palette. It contains Appearance, Notifications, Diagnostics, Keybindings and Runtime. On first open, the window appears after its controls, theme, translucency and zoom are prepared, instead of showing a blank opaque page while loading. Runtime-path detection can continue afterward. Opening it again focuses the existing ready window; Close or Escape closes that window. No project is required.

**Project settings** opens inside the current project window through the Project bar's gear, **⌘/Ctrl+Shift+,**, or the command palette. The header names the project. **Back** or **Escape** returns to its conversation; **Open global settings** opens the separate defaults window.

Pi keeps running. Project settings preserves your draft, conversation and reading position and restores prior focus when available. Pi extension dialogs retain priority. Global Settings does not launch, resume, stop or restart agents.

## Global defaults and project overrides

Project settings shows effective values, not a second independent configuration. **Global default** means the project follows the global value (or the built-in default/runtime discovery when omitted globally). Changing a control creates a **Project override**. **Use global default** removes that override and immediately follows the current global value again—it does not copy that value into the project file.

Overrides stay explicit even if they match the global value. Global edits update inheriting projects, but never replace explicit project values. The Appearance pane in global Settings links to open projects with overrides.

Project overrides cover **theme and runtime paths** only. **Typography, translucency, zoom, modal animations and auto-follow after sending are global-only**, along with notifications, diagnostics, keybindings, imported-theme storage and card-plugin configuration. Project settings contains only the theme picker under Appearance and runtime paths under Runtime. The project theme picker uses the shared global theme library; import and removal happen in global Settings.

This layering applies only to Nimrod preferences. Pi retains its own configuration and precedence.

## Categories and width

Category selection, unsaved Runtime fields and each category's reading position survive navigation and reopening Project settings in the same window, not app restart. In global Settings, these values and Keybindings search survive category changes while the Settings window remains open. **Edit keybindings…** in the command palette opens global Settings at Keybindings and focuses search; it has no default shortcut.

Use Up/Down in the category sidebar to cycle categories, Home/End for first/last, and Tab to enter the pane.

Drag the sidebar's right edge to resize it. Its width is saved app-wide, separately from project Session sidebar widths. With the handle focused, Left/Right adjust by 10px (Shift: 50px), Home/End choose current limits, and double-click restores the default. Narrow windows temporarily cap the width without overwriting your preference.

Escape during a drag cancels resizing; the next Escape closes Settings.

## Appearance

Sliders show the current value with an accent-colored filled track as soon as Settings opens, without needing a first adjustment. The fill follows theme changes and settings reloaded from disk.

- **Theme:** global changes update inheriting windows; project changes apply only to that project. See [Themes](themes.md) for live previews, bundled themes and imports.
- **Typography (global only):** independent conversation and monospace fonts/sizes, with searchable installed-font pickers and a live preview. See [Typography](#typography).
- **Translucency (global only):** whole-window background opacity (default **100% / Opaque**) and a macOS-only **Background blur** slider (0–40, default **20**) independent of opacity. Linux blur is configured in the desktop compositor. See [Translucency](translucency.md) for preview, accessibility and platform limitations.
- **Zoom (global only):** scales every project, Settings and reference window, default **125%**, range **75–200%**. Use the picker in global Settings or **⌘/Ctrl + / −** in a project window; shortcuts change the same global value. **⌘/Ctrl+0** resets to 100%. Zoom is remembered and doesn't change drafts.
- **Modal animation (global only):** choose **Subtle** (default), **CRT power-on**, **Hologram**, **Pixel dissolve** or **None**, then use **Preview animation** to try it.
  - **Subtle:** fade, tiny lift and gentle scale. Its **Duration (milliseconds)** slider ranges from **100–1500 ms** in **10 ms steps**, default **500 ms**. Closing is 25% shorter.
  - **Pixel dissolve:** shuffled chunky square tiles grow into the panel, then break apart in reverse on close. It uses the same **Duration (milliseconds)** setting as Subtle (default **500 ms**); closing is 20% shorter and does not fade the panel. **Pixel size** adjusts the grain (24–120 px target, default 48); large panels may coarsen it to keep the grid bounded. **Content blur** makes the text/content inside each hard-edged tile start blurred and sharpen (0–12 px, default 6). **Fade tiles in** fades each tile's actual content into view and is on by default. The reveal follows the modal's bounds at the current zoom; finishing it does not resize the panel. Closing reverses these effects. Set blur to **Off** and disable fade for the original sharp dissolve. Unsupported soft controls are disabled with an explanation. Try **500–1000 ms** in Preview for the full effect. Filtering/resizing during opening finishes the reveal immediately so results stay usable. Older renderers without path clipping fall back to a plain dialog.
  - **CRT / Hologram:** the slider becomes **Scan speed (pixels/second)**, **100–1500 px/s** in **50 px/s steps**. Defaults are **500 px/s for CRT** and **1000 px/s for Hologram**; bigger means faster. CRT's two accent lines reveal outward from the center; Hologram's glowing line reveals downward with a soft trail. Time depends on actual travel distance, not modal size percentages or a reference duration. Closing reverses the reveal at 25% higher speed (20% less time), without fading the panel.
  - Filtering a picker keeps each line's current pixel position and speed. Shrinking shortens the remaining travel or finishes if the results are already revealed; growth extends it. A tiny CRT picker that moves outside the old reveal band finishes rather than hiding its filtered results.
  - Duration and speed are remembered separately; an explicit speed is shared between CRT/Hologram. Previously saved millisecond durations remain for Subtle/Pixel and are not converted to px/s. Legacy durations clamp/round in memory, without an automatic file rewrite.
  - Sliders show a live value and save on commit/release, not every drag frame. Close/Escape in Preview use the same effect as ordinary dialogs. Input, focus and actions never wait for animation: closing animates only a non-interactive visual copy, and a new dialog clears stale motion. Reduced motion or **None** disables effects. Full-window Settings, native windows and transcript disclosures are unaffected; picker page changes stay in their mounted shell.
- **Auto-follow after sending (global only):** **When idle** (default) jumps to the bottom and follows new output for idle sends, but preserves your position for steering and queued follow-ups. **Always** does this for every message submission; **Never** preserves current scroll intent, including auto-follow if already active. Scrolling upward always pauses following. Changes synchronize across all projects. Changes affect subsequent sends without moving your current view. See [Reading conversations](reading-conversations.md#auto-follow-and-reading-older-output).
- Theme/import/zoom errors use the shared [notice strip](error-messages.md). Non-error progress and import details stay alongside the controls.

### Typography

Use **Global Settings → Appearance → Typography** to adjust reading comfort independently of interface scaling:

| Setting | Applies to |
| --- | --- |
| **Conversation font + size** | User/assistant prose, reasoning, formatted web prose, question/answer text and composer |
| **Monospace font + size** | Code blocks, inline code, raw tool inputs, code-like previews and literal tool output |
| **Zoom** | Everything, including sidebar, controls and spacing |

Both font choices start at **System default**, with **14px** sizes. Sizes range from **10–32 logical pixels**, in one-pixel steps. Zoom still applies: at the default 125% zoom, 14px text is displayed at a larger scale. Changing a font or size never changes zoom. Navigation, Settings, labels and other interface controls keep their system UI font.

Click a font button to search installed font families. Each family name is shown in its own font; **System default** stays first, and the Monospace picker puts fixed-pitch families before other fonts. Use Up/Down or Home/End to move, then Enter or click to choose. Escape or Close cancels without changing your font and returns to Settings. **Refresh** re-reads the installed fonts if you have added one. The app does not download fonts.

The preview contains prose, code and a composer sample. Selections apply immediately to the preview; saved changes synchronize to project and pop-out windows without restarting agents or replacing conversations. Typing a valid size previews it locally; leaving the field or using its step buttons saves it. Drafts, focus, disclosure choices and follow-versus-reading intent are retained while text reflows.

**Reset typography** restores both system fonts and 14px sizes, leaving theme and zoom alone. If a saved font is missing on another machine, the system fallback is used without erasing your choice. Font-list or save failures use the [application notice strip](error-messages.md).

Installed-font discovery and visual behavior still need native acceptance on macOS; Linux remains unverified.

## Notifications

**Background session alerts** are on by default. Turn them off across windows, send a fixed-content delivery test, or refresh read-only macOS diagnostics. See [Notifications](notifications.md) for triggers, click behavior and troubleshooting.

## Diagnostics

**Transcript debug logs** is off by default. Enable full-content local conversation traces for debugging; logs can contain secrets and are never uploaded. Logging is best-effort and never waits for disk during session delivery. Full buffers drop diagnostic records and report an incomplete capture rather than slowing session processing. See [Transcript debug logs](transcript-logs.md) for storage, retention and troubleshooting.

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
  "appearance.conversationFont": "",
  "appearance.conversationFontSize": 14,
  "appearance.monospaceFont": "",
  "appearance.monospaceFontSize": 14,
  "appearance.backgroundOpacity": 100,
  "appearance.backgroundBlur": 20,
  "appearance.autoFollowAfterSending": "whenIdle",
  "appearance.modalAnimation": "subtle",
  "appearance.modalAnimationDuration": 500,
  "appearance.modalScanSpeed": 1000,
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
