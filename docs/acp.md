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
- Permission requests appear **inside their own conversation area** with the exact offered choices and a Cancel request action. Tool details are resolved from earlier updates even when the request supplies only a tool-call ID; provided inputs, operation content (including diffs) and locations are shown literally. Permission patches are processed in arrival order with tool updates, so waiting for your choice cannot overwrite newer transcript details. The pending permission retains the details of the operation it asks you to approve. The call ID remains visible; missing details are explicitly identified. They do not open a global modal, select a background session or take focus. Return to that session to act. Existing notification preferences also apply to background input/completion.
- Pending permission choices are canceled when the turn stops, the connection fails or the session closes. Nothing is silently approved.
- A disconnected saved Copilot session can reconnect by selecting its row or choosing **Retry connection** in its session notice. Fix any executable/authentication problem first. Nothing is sent again automatically. Restart of a still-connected/stuck agent is not implemented; custom ACP sessions cannot reconnect in this POC.

## Reading and configuration

Pi and ACP sessions share the transcript, reasoning/tool-card runtime, disclosure/scroll behavior and presentation actions. ACP tool cards default to generic protocol-level rendering, with optional agent-specific or [external plugins](card-plugin-api.md#harness-targets-and-shared-runtime). Unsupported rich content is shown as literal JSON/text rather than inferred into a different tool schema; consecutive content blocks are retained independently.

Supported agent-advertised selectors appear through **ACP session options…**. Model, thinking and mode controls appear in the Status area only when the agent advertises their corresponding categories. Mode names and meanings belong to the agent. Other selectors remain in ACP session options. Changes are available while idle; working-turn configuration updates do not leave controls disabled afterward. The POC also accepts legacy ACP model/mode selectors. Advertised slash commands appear in composer completion and are sent as ordinary ACP prompts. Unadvertised slash commands are blocked locally, not accidentally forwarded to a model.

Session sidebar and Switch session include both backends. ACP rows and the Project bar identify the agent/ACP POC. Application commands such as Settings, themes and plugin reload remain Nimrod operations; Pi-only MCP inspection is not offered for ACP sessions.

## Persistence and current limits

**Copilot sessions created with the built-in Copilot option retain their sidebar entries and drafts across reload, quit and project reopening.** Nimrod remembers the Copilot session ID, title, message/creation recency and selected row, not a copy of the conversation or a history-list cache. Copilot owns the saved history.

Restored entries start disconnected, including the remembered selected row. Click a row or select it through Switch session to launch Copilot and load that exact conversation. History replay does not send a prompt, restore in-flight work, mark new message recency or generate completion alerts. Loading requires the agent's advertised saved-session capability. If Copilot is unavailable, loading is unsupported or history is missing, Nimrod keeps the row and draft and reports the error without creating a replacement. A missing executable can be a PATH/install problem; Nimrod does not assume uninstallation or erase anything.

**Close removes the sidebar entry, not Copilot's saved history or your saved draft.** It asks for confirmation because reopening a closed Copilot session through **Resume session** is not implemented yet. Keep an entry open if you want it back after quitting. Copilot pop-outs remain runtime-only and are not restored after app restart.

Custom ACP profiles/sessions retain the earlier runtime-only Nimrod lifecycle. Close, reload or quit discards their transcript, draft and pop-outs. The agent may retain its own history; Nimrod does not delete it. Sessions lost from the sidebar in earlier builds cannot be rediscovered by this change.

Resume session, saved-history deletion and Restart remain Pi-only. ACP history discovery, including the proposed project-scoped Copilot discovery process, is deferred to the Resume stage; no extra discovery process starts for sidebar restoration. The POC also lacks attachment sending, client-hosted filesystem/terminal services, login/elicitation flows and some protocol extensions. Agents must be able to execute their own tools without those client services. No Copilot SDK backend or in-place backend switching is implemented.

There is no real-agent or native platform acceptance yet. Intended platform direction remains macOS first, Linux next and possibly Windows later; this POC does not establish per-platform parity.
