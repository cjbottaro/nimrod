# Command palette

**Capture performance report** saves local timing data for a slowdown, after enabling Settings → Diagnostics. It has no default shortcut; the saved path appears in Diagnostics. See [Performance reports](performance-diagnostics.md).

**Reload card plugins** rescans personal TypeScript sources and refreshes the catalog for new cards, using cached bundles when unchanged. It does not restart Pi, send prompts or rebuild inspected cards. It has no default shortcut; assign one in [Keybindings](keybindings.md). See [Card plugins](card-plugins.md#startup-reload-and-caching).

Open with **⌘/Ctrl+Shift+P**, type an action or description, then press Enter or click a result. Commands show a short description and their effective shortcut; unbound actions leave the shortcut space empty. Every palette command is bindable; actions such as **Select theme…**, **Select mode…** and **Select context window…** have no default shortcut.

## Harness-aware commands

**New session** stays Pi-default. **New Copilot session** creates [Copilot](copilot.md), with the hint **Start a Copilot session**. This action is unbound by default. ACP creation/options actions are not exposed. Switch includes open sessions; Resume combines independent Pi/Copilot history sources. Delete uses Pi tree review or Copilot permanent deletion; unsupported history is omitted. Model/thinking/mode/context-window and Pi MCP commands reflect the selected
session’s actual support. Unsupported session actions are absent. Application
and project actions remain available without a selected session, so an empty
project can still create or resume work. Commands remain Nimrod-owned, not agent
slash commands.

## Pickers and cancellation

Some commands open a picker or name field:

- [Open recent project](projects.md#open-a-recent-project) searches directories.
- [Switch/Resume session](sessions.md#switch-or-resume) searches open conversations or saved history.
- [Delete sessions](sessions.md#delete-several-conversations) supports repeated cleanup.
- [MCP servers](mcp.md) shows a read-only server snapshot with selected-server details and Refresh.
- [Session configuration](model-thinking.md) marks the acknowledged current value with a **•**.
- [Select theme](themes.md#select-and-preview-themes) previews colors before saving.

**Escape closes the entire command interaction in one press**, including from a picker opened by a direct shortcut or Status-area button. It restores prior focus without changing your draft or stopping agents. Explicit **Back** returns to commands and retains the command query. Naming has Enter/Create and Escape, not a Back step.

Nested dialogs are different: a key recorder, Pi dialog or deletion review owns its own Escape. Deletion review leaves its picker visible underneath; Cancel returns unchanged, and Escape from the picker then closes it.

## Ordering

Commands accepted through the palette appear most recently used first next time. Unused commands follow alphabetically. Filtering retains that order, rather than ranking by match strength or frequency.

Opening a subordinate page counts immediately, even if you cancel it later. Highlighting, Escape, Back and direct shortcut/button invocation do not count. The latest 50 distinct command identities are remembered across projects and restarts. Subordinate pickers retain their own ordering.

History-save failures are reported without blocking or retrying the action.

## Confirmation dialogs

The palette, session pickers and confirmation dialogs share a denser glass panel when [translucency](translucency.md#glass-dialogs) is enabled. Opaque mode and Reduce Transparency keep solid dialogs. This changes their appearance, not keyboard behavior or focus restoration.

Ordinary dialogs and the palette use a restrained **Subtle** entrance by default. In global **Settings → Appearance → Modal animation**, choose None, Subtle, **CRT power-on**, **Hologram** or **Pixel dissolve**, then adjust the duration-based style's duration or CRT/Hologram's scan speed and preview it. Reduced motion disables animation; focus and keyboard handling stay immediate. See [Appearance](settings.md#appearance).

Confirmation buttons use plain action labels. The enabled confirmation action normally has focus. Use **Left/Up** or **Right/Down** to move between Cancel and the action button, wrapping and skipping disabled buttons. **Enter** activates the focused button; **Escape** cancels. Arrow navigation also works when a footer button has focus in input/select dialogs, keybinding dialogs and Pi editor dialogs; text fields, pickers and shortcut recording keep their normal arrow-key behavior.

Deletion loading initially focuses Cancel while Delete is disabled. If that loading dialog is already visible when the tree arrives, focus stays where you left it; use an arrow key or Tab to focus Delete, then Enter to proceed, or click Delete.

Settings is a separate full-window page; native file/directory choosers remain OS-controlled. Customize command shortcuts in [Keybindings](keybindings.md).
