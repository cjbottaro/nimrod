# ACP sessions (experimental POC)

Nimrod has an experimental Agent Client Protocol integration alongside its bespoke Pi integration. **The earlier POC/shared-view baseline passed offline checks and browser tests; the latest correctness fixes and Copilot sidebar restoration have not been validated. It has not been accepted with Copilot or another real agent in the native app.** It is not a broad compatibility guarantee.

## Start an ACP session

Open a project, then **⌘/Ctrl+Shift+P → New ACP session…**. This command has no default shortcut; it can be bound in [Keybindings](keybindings.md).

- **Copilot CLI** launches your installed `copilot --acp --stdio`. Install and authenticate Copilot in a terminal first; Nimrod does not provide an ACP login flow.
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
- Permission requests appear **inside their own conversation area** with the exact offered choices and a Cancel request action. Tool details are resolved from earlier updates even when the request supplies only a tool-call ID. Command requests show **Run command · description**, with a muted description that wraps when needed, followed by the exact command and permission buttons. Duplicate command metadata is shown once; distinct commands remain visible. A collapsed **Raw details** disclosure beneath the buttons contains the call ID and complete native tool details. Other request types retain literal inputs, operation content (including diffs) and locations. Permission patches are processed in arrival order with tool updates, so waiting for your choice cannot overwrite newer transcript details. The pending permission retains the details of the operation it asks you to approve. Missing details are explicitly identified; unsupported command shapes keep the literal fallback. They do not open a global modal, select a background session or take focus. Return to that session to act. Existing notification preferences also apply to background input/completion.
- Pending permission choices are canceled when the turn stops, the connection fails or the session closes. Nothing is silently approved.
- A disconnected saved Copilot session can reconnect by selecting its row or choosing **Retry connection** in its session notice. Fix any executable/authentication problem first. Nothing is sent again automatically. Restart of a still-connected/stuck agent is not implemented; custom ACP sessions cannot reconnect in this POC.

## Reading and configuration

Pi and ACP sessions share the transcript, reasoning/tool-card runtime, disclosure/scroll behavior and presentation actions. ACP tool cards default to generic protocol-level rendering, with optional agent-specific or [external plugins](card-plugin-api.md#harness-targets-and-shared-runtime). Unsupported rich content is shown as literal JSON/text rather than inferred into a different tool schema; consecutive content blocks are retained independently.

Supported agent-advertised selectors appear through **ACP session options…**. Model, thinking and mode controls appear in the Status area only when the agent advertises their corresponding categories. Mode names and meanings belong to the agent. Other selectors remain in ACP session options. Changes are available while idle; working-turn configuration updates do not leave controls disabled afterward. The POC also accepts legacy ACP model/mode selectors. Advertised slash commands appear in composer completion and are sent as ordinary ACP prompts. Unadvertised slash commands are blocked locally, not accidentally forwarded to a model.

Session sidebar and Switch session include both backends. ACP rows and the Project bar identify the agent/ACP POC. Application commands such as Settings, themes and plugin reload remain Nimrod operations; Pi-only MCP inspection is not offered for ACP sessions.

## Persistence and current limits

**Copilot sessions created with the built-in Copilot option retain their sidebar entries and drafts across reload, quit and project reopening.** Nimrod remembers the Copilot session ID, title, message/creation recency and selected row, not a copy of the conversation or a history-list cache. Copilot owns the saved history.

Restored entries start disconnected, including the remembered selected row. Click a row or select it through Switch session to launch Copilot and load that exact conversation. History replay does not send a prompt, restore in-flight work, mark new message recency or generate completion alerts. Loading requires the agent's advertised saved-session capability. If Copilot is unavailable, loading is unsupported or history is missing, Nimrod keeps the row and draft and reports the error without creating a replacement. A missing executable can be a PATH/install problem; Nimrod does not assume uninstallation or erase anything.

**Close removes the sidebar entry, not Copilot's saved history or your saved draft.** It asks for confirmation and stops that conversation's agent. Use **Resume session** to reopen closed history when your installed Copilot supports discovery and loading. Copilot pop-outs remain runtime-only and are not restored after app restart.

Custom ACP profiles/sessions retain the earlier runtime-only Nimrod lifecycle. Close, reload or quit discards their transcript, draft and pop-outs. The agent may retain its own history; Nimrod does not delete it.

Saved Copilot deletion is available only when the agent advertises the required support; see [Delete Copilot history](#delete-copilot-history). Restart remains Pi-only; custom-agent history discovery/deletion remains unavailable. The POC also lacks attachment sending, client-hosted filesystem/terminal services, login/elicitation flows and some protocol extensions. Agents must be able to execute their own tools without those client services. No Copilot SDK backend or in-place backend switching is implemented.

## Delete Copilot history

For the built-in Copilot profile, the row/Project bar trash controls, **Delete session…** / **⌘/Ctrl+Backspace**, and **Delete sessions…** / **⌘/Ctrl+Shift+Backspace** use Copilot's advertised ACP deletion method. This requires session listing, loading and deletion support in your installed version. Unsupported controls remain unavailable, and the cleanup picker omits unsupported Copilot history. Custom profiles remain unsupported.

The review names **one saved Copilot session**, not a descendants tree. Cancel/Escape keeps everything without stopping work. Confirming retains the dialog while Nimrod stops that conversation's owned agent, checks fresh project-history membership and requests permanent deletion. It neither creates/loads a conversation nor sends a prompt to delete closed history. Unrelated sessions and project discovery stay running. Nimrod does not inspect or remove Copilot's private files itself, and cannot coordinate external writers.

Only a confirmed response removes the session's sidebar entry, saved draft and runtime references. Failed shutdown, missing history or an unconfirmed result retains the row/draft and reports an error. A stopped row stays disconnected until explicit selection; nothing retries or creates a replacement conversation. If a response is lost, deletion may have happened: use Refresh to verify history before another explicit attempt. A remembered row whose history was actually removed can fail a later explicit load without losing its draft.

The cleanup picker remains open after each review, retaining its query and surviving rows. Accepting a deletion freezes unfinished discovery; use Refresh to finish loading other pages/sources. These deletion fixtures have not been run; installed-Copilot deletion and native platform acceptance remain pending.

## Resume Copilot history

**Resume session… / ⌘/Ctrl+K** combines Pi history with Copilot history for projects that have used the built-in Copilot option. Creating a built-in Copilot session or restoring a remembered Copilot sidebar entry establishes that project association. The association survives closing every Copilot row; custom profiles do not establish it.

For an associated open project, Nimrod runs one additional owned Copilot process for history discovery. It initializes without creating or loading a conversation or sending a prompt, stays available while the project is open, and stops when the project closes. Opening Resume or choosing Refresh requests fresh agent-owned history, including subsequent pages; Nimrod does not keep a persistent history-list cache or read Copilot's private session files.

Copilot rows show **Copilot ACP** immediately after the date, below the title. Closed entries have a dash indicator; already-open entries show the same title, time and activity as the sidebar and reuse that session when selected. Closed row times use Copilot's reported update time when available, not an inferred user-message timestamp. Resume sorts Pi and Copilot together by the displayed time, newest first; entries without a known time appear last.

Selecting a closed entry immediately opens its sidebar row and restores its draft, then loads that exact saved ID in the conversation's separate agent process. Replay never sends a prompt or restores in-flight work. Earlier conversations lost from Nimrod's sidebar may be recoverable if Copilot exposes them for the project's exact directory; discovery completeness depends on the installed agent/version.

Listing requires advertised ACP session-listing and loading support. A missing executable, unsupported discovery, unreadable history or connection failure appears in the application notice strip with Refresh guidance; available Pi history remains usable while Copilot is slow or unavailable, and vice versa. A load failure instead stays with its session, retaining its row and draft for **Retry connection**. Canceling Resume cannot reopen it through a late result and does not stop project discovery. Nothing falls back to a replacement conversation.

The new discovery/Resume fixtures have not been run. There is no installed-Copilot or native platform acceptance yet. Intended platform direction remains macOS first, Linux next and possibly Windows later; this POC does not establish per-platform parity.
