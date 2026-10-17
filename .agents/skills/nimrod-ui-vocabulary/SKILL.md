---
name: nimrod-ui-vocabulary
description: Canonical terminology for Nimrod desktop UI discussions and changes. Names surfaces, states and controls; feature specifications live in the features skill references.
---

# Nimrod UI vocabulary

Use these agreed terms in conversation, user guides and implementation work. This glossary names surfaces; it does not replace the [feature specifications](../features/SKILL.md).

## Page map

```text
┌─────────────────────────────────────────────┐
│ Project bar                                 │
├──────────────┬──────────────────────────────┤
│ Session      │ Transcript                   │
│ sidebar      │   User turn                  │
│ All/Unread/  │   Assistant turn             │
│ Working      │     Reasoning card           │
│              │     Tool card                │
│ Session rows │     Response text / code     │
│              ├──────────────────────────────┤
│              │ Status area                  │
│              ├──────────────────────────────┤
│              │ Composer                     │
└──────────────┴──────────────────────────────┘
```

Resume and other saved-history actions live in the command palette, not a sidebar action section. There is no conversation tab strip.

## Project and session terms

| Term | Meaning |
| --- | --- |
| **Project** | A canonical directory associated with one window and its sessions' cwd. No repository/manifest requirement. “Workspace” remains an internal compatibility name. |
| **Open / closed session** | Membership in the Session sidebar, independent of connectivity or filters. |
| **Connected / disconnected** | Live connection to a Nimrod-owned agent, not whether it is working. |
| **Working / idle** | Agent activity, not sidebar membership. Do not label all open sessions “Live sessions.” |
| **Sidebar views** | All, Unread and Working filters over open sessions, not saved-history lists or conversation tabs. |
| **Switch session** | Picker for open sessions, including disconnected and temporary entries. |
| **Resume session** | Picker for saved top-level project history, including closed sessions. |
| **New session / New named session** | Persistent conversation, optionally named before launch. |
| **Temporary session** | Explicit runtime-only conversation. Close is not deletion for saved sessions. |
| **Delete sessions picker** | Repeated saved-history cleanup action, distinct from selected-session deletion. |
| **Delete session tree** | Selected/row-targeted deletion review for a session and descendants, distinct from Close. |
| **Delete session** | Copilot's capability-gated review/removal of one saved session, using the shared deletion controls without Pi tree semantics. |
| **Restart session** | Stop and resume the selected saved session's process; not Pi `/reload`, a webview reload or New session. |

[Projects/sessions](../features/references/projects-and-sessions.md), [navigation](../features/references/session-navigation.md), [sidebar views](../features/references/sidebar-attention.md) and [deletion](../features/references/session-deletion.md) own behavioral contracts. Internal `Tab`/`tabs` names don't imply visible tabs.

## Main regions

| Term | Meaning | Code anchor |
| --- | --- | --- |
| **Native title bar** | OS-owned window title/control strip (macOS traffic lights), distinct from the Project bar | Native window frame |
| **Project bar** | Top project identity/action strip | `#workspace-bar` |
| **Session sidebar** | Collapsible open-session navigation | `#session-sidebar` |
| **Global Settings window** | Singleton app-owned window for global defaults and global-only preferences | Native `settings` window |
| **Project settings page** | Full-window project override surface inside its owning project window | `#settings-page` |
| **Settings page** | Shared preferences layout used by both scopes | `#settings-page` |
| **Category sidebar** | Settings category navigation | `#settings-sidebar` |
| **Settings content pane** | Independently scrolling selected category | `.settings-panel` |
| **Transcript** | User/assistant history | `#messages` |
| **Transcript pane** | Scroll container around the transcript | `#transcript-viewport` |
| **Status area** | Activity, model/thinking, usage, queues and recovery | `#activity` |
| **Composer** | Prompt field, Send/Stop and keyboard hints | `#composer` |
| **Interaction area** | Status area and composer, including submission notices | `#composer-area` |
| **Conversation area** | A session's transcript and interaction area together | `.session-view` inside `#conversation` |

Mounted IDs are unique per session; anchors above are semantic template names with stable `data-pi-id` hooks. Avoid “main content area” when a specific region is intended.

## Transcript elements

- **Turn** — visible user/assistant entry. Assistant turn includes reasoning/tools/text; not necessarily one RPC turn interval.
- **Reasoning card** — disclosure for thinking supplied by Pi.
- **Tool card** — invocation and output. Its **summary row** contains a **disclosure arrow**, **input preview** and state indicator; the **expanded body** contains details, **raw inputs** and an independently scrolling **output viewport**.
- **Code block** — formatted source with language label and Pop out/Copy controls.
- **Pop-out** — separate captured-code/rendered-Markdown reference window. **Copy source** means Markdown's whole-document source action, distinct from nested code Copy.
- **Parallel-tools overview** — temporary summary of overlapping invocations, not replacement tool cards.
- **Skill disclosure** — collapsed skill body inside a user turn; user arguments remain outside.
- **Pending user turn** — local user-turn preview awaiting acknowledgement/authoritative user event; includes ordinary sends and **pending steering turns**.
- **Configuration change** — Nimrod-owned local transcript entry for an accepted session-setting change, distinct from a user/assistant turn or saved harness history. [Model/thinking](../features/references/model-thinking.md) owns its behavior.
- **Queue entries / recovered messages** — authoritative pending work versus text retained for explicit Restore.

A **card** needn't have a visible rectangle. A **disclosure** expands/collapses; it is not a dialog. [Cards](../features/references/transcript-cards.md), [composer](../features/references/composer.md) and [pop-outs](../features/references/pop-outs.md) own behavior.

## Controls and feedback

- **Action** — an operation that must be available in the command palette. A keybinding is optional; buttons and menus may provide additional entry points to the same action. “Command” is synonymous in command-palette discussions; not every button or UI interaction is an action.
- **Command palette** — modal action selector; subordinate pickers are pages in that interaction.
- **MCP inspector** — read-only session-server inspection page in the command palette, with selected-server details and Refresh. [MCP inspector](../features/references/mcp-inspector.md) owns its contract.
- **Model picker / thinking-level picker / mode picker / context-window picker** — session configuration selection pages; “effort” is a thinking-level search alias. Mode and context-window pickers appear only when the selected session contributes those actions.
- **Activity indicator** — spinner/dot with activity context; specify main agent/subagent/tool/reasoning when ambiguous.
- **Usage metrics** — harness-reported context and cost/credit usage, formatted by its integration.
- **Prompt field / Send/Stop button / keyboard hints** — composer input, primary action and delivery hints.
- **Session notices** — session-owned operational feedback at the top of its conversation area, above and outside the transcript pane, aligned with its gutters. Visible only in that session; not transcript entries or sidebar indicators.
- **Application notice strip** (or **notice strip**) — shell-owned window/application feedback 48 CSS pixels below the viewport top, including Settings/dialogs. It reserves space and remains accessible through the active dialog's top layer. [Error presentation](../features/references/error-presentation.md) owns placement, routing and lifecycle for both notice surfaces.
- **Submission notice** — legacy standalone-renderer feedback near the composer; the app routes this feedback to session notices.
- **Slash suggestions** — autocomplete above the composer.
- **Keybinding editor / key recorder** — action shortcut list and nested combination-capture dialog.
- **Open project / Open recent project** — native directory chooser versus searchable recent-directory picker.
- **Settings gear / Runtime paths / Zoom picker** — Project settings entry in the Project bar, next-launch executable preferences and whole-webview scale selector.
- **Global default / Project override / Use global default** — Setting provenance and the action that removes a project override, not a copied value.
- **Desktop notification** — OS-level background alert, distinct from Pi in-app notices. **Background session alerts**, **Send test notification** and **Refresh notification diagnostics** are Settings controls.
- **Permission panel** — Copilot's session-local approval surface above the Status area: one active request, pending count/list, one-time/scoped approval and denial controls. Not a blocking dialog. [Permission specification](../features/references/copilot-sdk.md#permission-choices-and-panel) owns scope and lifecycle.
- **Dialog / modal shell** — choice/editing overlay versus its shared outer geometry/style. Project settings is the full-window exception; Global Settings has its own native window.

[Command interactions](../features/references/command-interactions.md), [keybindings](../features/references/keybindings.md), [Settings](../features/references/settings-layout.md), [notifications](../features/references/notifications.md) and [modal layout](../features/references/modal-layout.md) own specifications.

## Theme, layout and scrolling

- **Background opacity** — theme-background tint strength, not whole-app/text opacity. **Frosted background** adds native desktop blur on supported platforms. **Whole window / Sidebar and Project bar** names the translucent surface selection; avoid “chrome” in user-facing controls. [Translucency](../features/references/translucency.md) owns behavior.
- **Theme picker / imported theme** — palette selection surface versus a saved standalone color-theme copy, not a VS Code extension.
- **Nimrod scheme** — Nimrod's custom dark/light blue-gray, mint/teal and warm-gold palette in `src/theme.css`; not a third-party VS Code theme. **Dracula** is a distinct adaptation.
- **Sidebar resize handle** — draggable/focusable right edge; a vertical separator.
- **Separator** — dividing line, such as Status-area borders.
- **Accent line** — colored vertical turn marker.
- **Expanded-content guide** — line beneath a disclosure arrow, not a turn accent.
- **Gutter / fluid width / zoom** — side padding, available-width layout and whole-webview scaling; not interchangeable.
- **Auto-follow** — transcript staying at live bottom; specify **tool-output auto-follow** for the inner output viewport.

[Themes](../features/references/themes.md), [resizing](../features/references/sidebar-resize.md) and [transcript interaction](../features/references/transcript-interaction.md) own exact rules.

Examples: “The tool card's input preview is too narrow,” “The transcript gutter is too wide,” “Opening that disclosure must not re-enable auto-follow.”

Keep agreed names here rather than duplicating the glossary in AGENTS.md or adding detailed lifecycle specifications.
