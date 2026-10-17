# ACP sessions (experimental POC)

Nimrod retains experimental generic ACP alongside bespoke Pi and [official SDK Copilot](copilot.md). **New built-in Copilot sessions no longer use ACP.** The Copilot-specific persistence/history/deletion sections below apply only to preserved **legacy ACP** entries and drafts, not SDK sessions. Earlier ACP baseline checks do not validate the SDK migration or native/real-agent compatibility.

## Start an ACP session

Open a project, then **⌘/Ctrl+Shift+P → New ACP session…**. This command has no default shortcut; it can be bound in [Keybindings](keybindings.md).

- **New Copilot session** is a separate [SDK command](copilot.md). Existing legacy ACP rows still launch `copilot --acp --stdio` on explicit selection; they are not migrated automatically.
- **Custom ACP agent…** accepts a JSON launch profile. `command` is an executable name on PATH or an absolute path; `args` is a literal array, not a shell command. For example:

  ```json
  {
    "name": "My agent",
    "command": "/absolute/path/to/agent",
    "args": ["--acp"],
    "env": {}
  }
  ```

Custom profiles are not remembered in this POC. Their environment is passed to the child, not saved in Nimrod's settings. If executable discovery fails from a desktop launch, use an absolute path. Nimrod prepends the configured Runtime Node directory when it is available; native ACP agents do not require Node. For a JavaScript entry point you can explicitly use Node as `command` and put the script path first in `args`.

If the native ACP host is unavailable or reload cleanup fails, New ACP session stays unavailable and a notice explains the failure; Pi can still start normally.

Nimrod uses the project's exact directory. Opening the session does not submit a prompt. The installed agent still runs its normal startup/configuration behavior; sending a message uses the real agent and its normal provider/account.

**New session**, **New named session** and **New temporary session** remain explicitly Pi operations, even while an ACP session is selected. A session's backend is fixed; model/thinking changes do not convert Pi to ACP or switch ACP agents.

## Send, Stop and permissions

- Text sends immediately clear the composer and preview the user turn; later events reconcile it without automatic retries or draft restoration.
- While an ACP turn is running, the primary button is **Stop**. Enter does not steer or queue; the newer draft remains editable and is kept. Stop requests cancellation and waits for the agent's turn-completion response.
- Permission requests appear **inside their own conversation area** with the exact offered choices and a Cancel request action. Tool details are resolved from earlier updates even when the request supplies only a tool-call ID. Command requests show **Run command · description**, with a muted description that wraps when needed, followed by the exact command and permission buttons. Duplicate command metadata is shown once; distinct commands remain visible. A collapsed **Raw details** disclosure beneath the buttons contains the call ID and complete native tool details. Fetch requests show **Fetch · URL** with the same offered buttons and collapsed raw details; other request types retain literal inputs, operation content (including diffs) and locations. Permission patches are processed in arrival order with tool updates, so waiting for your choice cannot overwrite newer transcript details. The pending permission retains the details of the operation it asks you to approve. Missing details are explicitly identified; unsupported command shapes keep the literal fallback. They do not open a global modal, select a background session or take focus. Return to that session to act. Existing notification preferences also apply to background input/completion.
- Pending permission choices are canceled when the turn stops, the connection fails or the session closes. Nothing is silently approved.
- A disconnected saved Copilot session can reconnect by selecting its row or choosing **Retry connection** in its session notice. Fix any executable/authentication problem first. Nothing is sent again automatically. Restart of a still-connected/stuck agent is not implemented; custom ACP sessions cannot reconnect in this POC.

## Reading and configuration

Pi and ACP sessions share the transcript, reasoning/tool-card runtime, disclosure/scroll behavior and presentation actions. ACP tool cards default to generic protocol-level rendering, with optional agent-specific or [external plugins](card-plugin-api.md#harness-targets-and-shared-runtime). Unsupported rich content is shown as literal JSON/text rather than inferred into a different tool schema; consecutive content blocks are retained independently.

Copilot has compact bundled cards for common inspection tools:

- **Read file** shows the path relative to your project directory when it is inside the project, or its absolute path otherwise, followed by a middle dot and requested line numbers when supplied: `src/client.ts · lines 20–40`. The filename and directory are no longer split into separate fields.
- **Search** puts the complete text pattern first, followed by the supplied search scope and optional file filter. Scope paths use the same project-relative/otherwise-absolute display rule.
- **Find files** shows a filename pattern and supplied search scope, with the same path display rule.
- **Web search** shows the complete query, a formatted answer, numbered citations and a compact deduplicated source list when Copilot supplies structured citation data.
- **Fetch** shows the requested URL and any requested character offset. Recognized page output is formatted Markdown; raw-source responses stay literal. Reported redirects and partial-content notices remain visible, with no automatic follow-up requests. Failures show the agent’s error message. Document links resolve against the returned page URL, not your project; source/page links open only when clicked through Nimrod’s normal link handling.

Fetch permission requests use the same compact **Fetch · URL** summary with the offered permission buttons and collapsed Raw details. Approval/cancellation behavior is unchanged. Unknown URL or result shapes retain the literal fallback.

Recognized Copilot output wrappers show their plain content rather than duplicate JSON/diff representations. The complete original output remains in a collapsed **Raw output** disclosure; **Raw inputs** follows the result. File/local-search output stays literal. Web Markdown is sanitized; fetched raw source remains literal, and unsupported citation spans remain visible rather than being guessed. No remote HTML or images are executed/loaded by these cards. Unknown agents, unsupported payload shapes and other tools keep their generic presentation. New cards retain the existing disclosure, status and reading-position behavior; these presentation changes have not yet been validated in the native app.

Supported agent-advertised selectors appear through **ACP session options…**. Model, thinking and mode controls appear in the Status area only when the agent advertises their corresponding categories. Mode names and meanings belong to the agent. Other selectors remain in ACP session options. Changes are available while idle; working-turn configuration updates do not leave controls disabled afterward. The POC also accepts legacy ACP model/mode selectors. Advertised slash commands appear in composer completion and are sent as ordinary ACP prompts. Unadvertised slash commands are blocked locally, not accidentally forwarded to a model.

Session sidebar and Switch session include both backends. ACP rows and the Project bar identify the agent/ACP POC. Application commands such as Settings, themes and plugin reload remain Nimrod operations; Pi-only MCP inspection is not offered for ACP sessions.

## Persistence and current limits

**Copilot sessions created with the built-in Copilot option retain their sidebar entries and drafts across reload, quit and project reopening.** Nimrod remembers the Copilot session ID, title, message/creation recency and selected row, not a copy of the conversation or a history-list cache. Copilot owns the saved history.

Restored entries start disconnected, including the remembered selected row. Click a row or select it through Switch session to launch Copilot and load that exact conversation. History replay does not send a prompt, restore in-flight work, mark new message recency or generate completion alerts. Loading requires the agent's advertised saved-session capability. If Copilot is unavailable, loading is unsupported or history is missing, Nimrod keeps the row and draft and reports the error without creating a replacement. A missing executable can be a PATH/install problem; Nimrod does not assume uninstallation or erase anything.

**Close removes the sidebar entry, not Copilot's saved history or your saved draft.** It asks for confirmation and stops that conversation's agent. Use **Resume session** to reopen closed history when your installed Copilot supports discovery and loading. Copilot pop-outs remain runtime-only and are not restored after app restart.

Custom ACP profiles/sessions retain the earlier runtime-only Nimrod lifecycle. Close, reload or quit discards their transcript, draft and pop-outs. The agent may retain its own history; Nimrod does not delete it.

Legacy ACP Copilot deletion is available only when the agent advertises the required support; see [Delete Copilot history](#delete-copilot-history). New SDK sessions use their own supported deletion API, not that optional ACP capability. Restart remains Pi-only; custom-agent history discovery/deletion remains unavailable. The POC also lacks attachment sending, client-hosted filesystem/terminal services, login/elicitation flows and some protocol extensions. Agents must execute their own tools. No in-place ACP/SDK switching or draft aliasing is implemented.

## Delete Copilot history

For retained legacy Copilot ACP entries, the row/Project bar trash controls, **Delete session…** / **⌘/Ctrl+Backspace**, and **Delete sessions…** / **⌘/Ctrl+Shift+Backspace** use Copilot's advertised ACP deletion method. This requires session listing, loading and deletion support in your installed version. Unsupported controls remain unavailable, and the cleanup picker omits unsupported Copilot history. Custom profiles remain unsupported.

**Copilot 1.0.98 does not advertise deletion in the installed version inspected locally.** Its trash controls remain disabled and explain the missing support. The local CLI also exposes no `copilot sessions delete` command. This implementation does not enable deletion for that version: Nimrod has no established supported alternative and will not remove Copilot's private files or send a prompt to emulate deletion. **Close** removes the sidebar entry while retaining saved history and drafts.

The review names **one saved Copilot session**, not a descendants tree. Cancel/Escape keeps everything without stopping work. Confirming retains the dialog while Nimrod stops that conversation's owned agent, checks fresh project-history membership and requests permanent deletion. It neither creates/loads a conversation nor sends a prompt to delete closed history. Unrelated sessions and project discovery stay running. Nimrod does not inspect or remove Copilot's private files itself, and cannot coordinate external writers.

Only a confirmed response removes the session's sidebar entry, saved draft and runtime references. Failed shutdown, missing history or an unconfirmed result retains the row/draft and reports an error. A stopped row stays disconnected until explicit selection; nothing retries or creates a replacement conversation. If a response is lost, deletion may have happened: use Refresh to verify history before another explicit attempt. A remembered row whose history was actually removed can fail a later explicit load without losing its draft.

The cleanup picker remains open after each review, retaining its query and surviving rows. Accepting a deletion freezes unfinished discovery; use Refresh to finish loading other pages/sources. These deletion fixtures have not been run; successful deletion with an agent advertising support and native platform acceptance remain pending.

## Resume Copilot history

**Resume session… / ⌘/Ctrl+K** retains legacy ACP Copilot history for projects with its historical association or restored legacy entries. New SDK creation establishes a separate association and [SDK history source](copilot.md#history-close-and-delete). Associations survive closing every corresponding row; custom ACP profiles establish neither.

For an associated open project, Nimrod runs one additional owned Copilot process for history discovery. It initializes without creating or loading a conversation or sending a prompt, stays available while the project is open, and stops when the project closes. Opening Resume or choosing Refresh requests fresh agent-owned history, including subsequent pages; Nimrod does not keep a persistent history-list cache or read Copilot's private session files.

Legacy Copilot history rows show **Copilot (legacy ACP)** immediately after the date, below the title. Closed entries have a dash indicator; already-open entries show the same title, time and activity as the sidebar and reuse that session when selected. Closed row times use Copilot's reported update time when available, not an inferred user-message timestamp. Resume sorts Pi and Copilot together by the displayed time, newest first; entries without a known time appear last.

Selecting a closed entry immediately opens its sidebar row and restores its draft, then loads that exact saved ID in the conversation's separate agent process. Replay never sends a prompt or restores in-flight work. Earlier conversations lost from Nimrod's sidebar may be recoverable if Copilot exposes them for the project's exact directory; discovery completeness depends on the installed agent/version.

Listing requires advertised ACP session-listing and loading support. A missing executable, unsupported discovery, unreadable history or connection failure appears in the application notice strip with Refresh guidance; available Pi history remains usable while Copilot is slow or unavailable, and vice versa. A load failure instead stays with its session, retaining its row and draft for **Retry connection**. Canceling Resume cannot reopen it through a late result and does not stop project discovery. Nothing falls back to a replacement conversation.

The new discovery/Resume fixtures have not been run. There is no installed-Copilot or native platform acceptance yet. Intended platform direction remains macOS first, Linux next and possibly Windows later; this POC does not establish per-platform parity.
