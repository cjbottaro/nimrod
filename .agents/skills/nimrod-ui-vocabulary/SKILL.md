---
name: nimrod-ui-vocabulary
description: Shared vocabulary for Nimrod's desktop UI. Load when discussing, designing, implementing, debugging, or reviewing layout, transcript rendering, tool/reasoning cards, the composer, status area, settings, themes, zoom, scrolling, or focus. Use these names consistently when interpreting user feedback and describing changes.
---

# Nimrod UI vocabulary

This is the canonical shared vocabulary agreed with the user. Use it in conversation, documentation, and UI-related implementation work. It names surfaces; it does not authorize new features or replace the behavior contract in [architecture.md](../../../docs/architecture.md).

## Page map

```text
┌─────────────────────────────────────────────┐
│ Project bar                                 │
├──────────────┬──────────────────────────────┤
│ Session      │ Transcript                   │
│ sidebar      │   User turn                  │
│              │   Assistant turn             │
│ Open         │     Reasoning card           │
│ sessions     │     Tool card                │
│              │     Response text / code     │
│ Resume       │                              │
│ session…     │                              │
│              ├──────────────────────────────┤
│              │ Status area                  │
│              ├──────────────────────────────┤
│              │ Composer                     │
└──────────────┴──────────────────────────────┘
```

The status area and composer together form the **interaction area**.

## Project/session navigation

- **Project** — one canonical directory associated with a window and used as its sessions' working directory. No Git repository, manifest or registration is required; opening a directory opens a project. A project may contain gitignored worktree directories, but sessions launched with a different working directory currently belong to a separate project window. “Workspace” is retained only in internal identifiers and compatibility keys.
- **Open session** — a conversation kept open within the project; selecting another session does not stop its agent. There is no visible tab strip. Internal `Tab`/`tabs` identifiers and existing storage keys are implementation details.
- **Session sidebar** — collapsible, resizable navigation showing open sessions, their activity and per-row Delete session tree/Close controls, with **All** / **Unread** / **Working** view tabs, each showing a live session count including zero. It does not repeat the project directory, contain an Open sessions disclosure, or include a separate history/navigation action section. There is no All sessions section or persistent sidebar search field.
- **Command palette** — the modal command selector opened by Cmd/Ctrl+Shift+P; there is no Project bar palette button.
- **Sidebar views** — **All** shows every open session most recently used first. New sessions start at creation time; Resume inserts at remembered recency or the latest saved user-message timestamp. Only Pi-acknowledged messages (`prompt` requests) advance live **last used**; selecting/reading, renaming, other metadata/control operations and background output/completion do not change order. Saved entries retain recency across Close/reopening. Row second lines show **relative time · date** with text-only minute/foreground refreshes; the left state indicator conveys inactive, ready, working, unread, input, failure and lifecycle states. Reordering preserves the sidebar viewport instead of chasing the moved row; explicit navigation and returning to All reveal the selected session. **Unread** shows outstanding input, unread completed responses and session failures in stable arrival order; resolved selected rows stay until leaving. Its empty state shows **N sessions working…** with a reduced-motion-aware pulse while agents are busy; otherwise **No unread sessions**. The conversation area is blank without a selected row in the current view; a working session without attention is hidden on entry. New arrivals never open themselves. Explicit navigation to a filtered-out session switches to All. **Working** shows busy/compacting sessions and reported subagent activity in All's recency order, excluding input-waiting, inactive and lifecycle-transition sessions. A selected settled row stays readable until leaving the view, but no longer counts as working. Counts can overlap. Both filtered views can leave the conversation area blank when the remembered session is outside the filter. These are filters, not conversation tabs or saved-history lists.
- **Switch session** — the command-palette picker for switching between all open sessions, including those hidden by a sidebar view and temporary/demo sessions. It does not discover historical sessions.
- **Session picker** — the palette's **Resume session** step: type-to-filter all resumable project history, including closed sessions, with already-open sessions marked. Escape returns to commands; Escape from commands closes the palette.
- **Open session** is not necessarily running: it may be active, idle, or inactive pending explicit resume. Do not label the whole section “Live sessions”.
- **New session** — the normal, persistent default. **New named session** — a compact command-palette step with a focused single-line name field and inline **Create** button; Enter creates, Esc cancels. Starts a persistent session using Pi's native `--name` launch option. **Temporary session** — an explicitly selected, visibly marked exception, absent from historical listings.
- Closing an open session is not deleting it. Opening an already-open session focuses its existing conversation area.

See [project/session implementation](../../../docs/workspace-sessions.md) for lifecycle boundaries and remaining native acceptance. Each open session owns its conversation area. Template IDs below remain semantic names, but mounted nodes use unique IDs and corresponding `data-pi-id` attributes.

## Main regions

| Term | Meaning | Current code anchor |
| --- | --- | --- |
| **Project bar** | Top strip containing the sidebar toggle, Nimrod wordmark, project directory, active-session mode badge, Restart session icon, Delete session tree icon, and Settings gear. Preferences themselves live on the Settings page. | `#workspace-bar` |
| **Settings page** | Full-window preferences surface opened by the gear or ⌘/Ctrl comma; Appearance, Notifications, Keybindings and Runtime sections, with Back/Escape navigation. Covers the still-mounted project using native dialog modality. | `#settings-page` |
| **Transcript** | Conversation history: user/assistant entries and their content. | `#messages` |
| **Transcript pane** | The independently scrolling container around the transcript. | `#transcript-viewport` |
| **Status area** | Agent activity, model/thinking controls, usage metrics, extension statuses, and queued/recoverable messages. | `#activity` |
| **Composer** | Message-writing surface, including the prompt field, Send/Stop button, and keyboard hints. | `#composer` |
| **Interaction area** | Status area and composer together, including submission notices between them. | `#composer-area` |

Use **conversation area** for a session's transcript and interaction area together (`.session-view` inside `#conversation`). “Main content area” is less precise; identify the intended region before changing unrelated surfaces.

## Inside the transcript

- **Turn** — a visible user or assistant entry. “Assistant turn” includes reasoning, tools, and response text, not only the final prose. This is UI vocabulary; it is not necessarily one Pi RPC `turn_start`/`turn_end` interval.
- **Reasoning card** — collapsible thinking text actually supplied by the harness.
- **Tool card** — a tool invocation and its output.
  - **Summary row** — its always-visible header.
  - **Disclosure arrow** — the arrow used to expand/collapse it.
  - **Input preview** — abbreviated filename, command, or description beside the tool name.
  - **Expanded body** — details revealed when opened.
  - **Output viewport** — the independently scrollable tool-output region.
  - **Raw inputs** — the nested disclosure containing full arguments.
- **Code block** — formatted code with a language label, icon-only **Pop out** (left) and **Copy** (right) buttons. Copy briefly displays a checkmark after success; both actions have tooltips and accessible labels.
- **Pop-out** — a separate reference window showing captured code or rendered Markdown, visible for the active project's selected session. Focusing a pop-out keeps its owning project active; switching project windows hides the outgoing project's references. **Copy source** is the whole-document Copy icon in a Markdown pop-out, distinct from nested code-block Copy. See the [feature guide](../../../docs/pop-outs.md) for behavior and [implementation reference](../features/references/pop-outs.md) for internals.
- **Parallel-tools overview** — the temporary card summarizing genuinely overlapping tool executions; it does not replace individual tool cards.
- **Skill disclosure** — the collapsed skill body within a user turn, labeled `/skill:name`; user arguments remain outside it.

A **card** does not imply a visible rectangular border. A **disclosure** is an expand/collapse control, not a dialog.

## Controls and feedback

- **Desktop notification** — an OS-level background-session alert, distinct from in-app Pi extension notices. **Background session alerts** is its On/Off control in Settings → Notifications. **Send test notification** checks OS delivery without launching an agent; the adjacent status line records the latest attempt/suppression/error and macOS policy/foreground-handler diagnostics. **Refresh notification diagnostics** reads those values without posting an alert or requesting permission. Current banners do not provide reliable click-to-session routing.
- **Activity indicator** — a spinner or dot, with accompanying status text where present. Specify main-agent, subagent, tool, or reasoning when ambiguous.
- **Model picker / thinking-level picker** — searchable command-palette selection pages, opened through **Select model…** / **Select thinking level…** or the status-area model/thinking buttons. “Effort” is a search alias for thinking level. Current values are marked; Escape returns to commands. These use the same selection surface as Resume session, not the extension select dialog.
- **Usage metrics** — harness-reported cost and context estimates in the status area.
- **Queue entries** — authoritative queued/steering messages. **Recovered messages** are text retained for explicit restoration, not messages automatically resubmitted.
- **Prompt field** — the editable text input inside the composer (`#prompt`).
- **Send/Stop button** — the composer's primary action (`#send`).
- **Keyboard hints** — the shortcut text beneath the prompt field.
- **Keybinding editor** — Settings → Keybindings: searchable Nimrod action list with effective shortcut(s), scope, Modified indicators and Add/Remove/Reset controls. **Key recorder** is its nested dialog for capturing a shortcut without executing it; **Reassign** explicitly removes conflicting bindings. **Reset all** restores built-in defaults after confirmation. Composer delivery shortcuts and Pi’s internal keymap are outside this editor.
- **Submission notice** — acknowledgement uncertainty, validation, or recovery feedback near the composer.
- **Slash suggestions** — the command autocomplete popup above the composer.
- **Restart session** — the Project bar's reload-style icon (and palette action) that stops the selected Pi process and resumes its exact saved history without replaying messages. Disabled for temporary/demo sessions, before first save, and during lifecycle transitions. This is not a webview reload or a new conversation.
- **Delete session tree** — the per-row trash icon immediately left of Close targets that saved session and its descendants without selecting or resuming it. The Project bar trash icon and palette action target the selected saved session. Uses Nimrod's Rust-native file preview/removal and a custom, scrollable tree-confirmation dialog with session icons and branch guide lines, shown only in the initiating window. Cross-project descendants are labeled with their project directories. Confirmed successes remove associated drafts/references and select the next surviving sidebar row, falling back from a filtered view to All when needed. Temporary/unsaved sessions cannot be deleted; affected work must be idle. This is distinct from closing a session. Failed/unknown outcomes retain inactive sessions for explicit recovery through Resume session.
- **Open project** — native File-menu action (Cmd/Ctrl+O), not a Project bar button or command-palette action. The welcome screen still offers directory selection.
- **Settings gear** — the project-bar button that opens the Settings page; it does not stop the session.
- **Runtime paths** — saved Pi/Node executable preferences under Settings → Runtime. **Save runtime paths** commits them for the next session, not the current process.
- **Zoom picker** — the percentage selector in Settings → Appearance; it adjusts native webview page zoom.
- **Dialog** — an overlay requiring an explicit choice or dismissal, unlike an inline card/disclosure.

## Theme

- **Theme picker** — the selector in Settings → Appearance for built-in and imported color schemes. Its **Import color theme…** action opens a local file chooser for standalone VS Code JSON/JSONC themes.
- **Imported theme** — a saved local copy of an imported color palette, not an installed VS Code extension or terminal configuration. See [theme behavior](../../../docs/themes.md).
- **Dracula** — Nimrod's dark adaptation of the established Dracula palette; distinct from the app's own scheme.
- **Nimrod scheme** — the app's custom theme, defined in `src/theme.css`, with dark and light variants. Blue-gray foundations, mint/teal accents, and warm gold details. Use this name rather than calling it a VS Code theme or attributing it to an existing third-party palette. Some syntax-highlighting fallback colors are inherited from the original renderer.

## Layout and scrolling

- **Sidebar resize handle** — the draggable right edge of the Session sidebar; a focusable vertical separator with keyboard width controls. Width is remembered per project in app state, independently of sidebar visibility and view.
- **Separator** — a horizontal dividing line, such as either status-area border.
- **Accent line** — the colored vertical line beside a turn.
- **Expanded-content guide** — the thin vertical line beneath a disclosure arrow alongside expanded details; distinct from a turn's accent line.
- **Gutter** — empty side padding.
- **Fluid width** — content grows/shrinks with the window, retaining its gutter rather than a fixed-width centered column.
- **Zoom** — visual scaling of the whole webview UI. Distinguish this from window resizing/fluid width.
- **Auto-follow** — keeping the transcript at the bottom as output arrives when the reader was already following live work. Specify **tool-output auto-follow** for scrolling within a tool's output viewport.

Examples: “The tool card's input preview is too narrow,” “The transcript gutter is too wide,” or “Opening that disclosure should not re-enable auto-follow.”

Keep this skill updated when new vocabulary is agreed. Do not silently repurpose established terms or duplicate the glossary in AGENTS.md.
