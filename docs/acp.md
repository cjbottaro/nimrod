# ACP sessions (experimental POC)

Nimrod has an experimental Agent Client Protocol integration alongside its bespoke Pi integration. **The initial POC passed offline checks and browser tests; the latest shared-view and correctness changes have not yet been validated. It has not been accepted with Copilot or another real agent in the native app.** It is not a broad compatibility guarantee.

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
- Permission requests appear **inside their own conversation area** with the exact offered choices and a Cancel request action. Tool details are resolved from earlier updates even when the request supplies only a tool-call ID; provided inputs, operation content (including diffs) and locations are shown literally. The call ID remains visible; missing details are explicitly identified. They do not open a global modal, select a background session or take focus. Return to that session to act. Existing notification preferences also apply to background input/completion.
- Pending permission choices are canceled when the turn stops, the connection fails or the session closes. Nothing is silently approved.
- If the agent stops responding, the POC cannot reconnect or restart that conversation. Close it and explicitly create another session; nothing is replayed.

## Reading and configuration

Pi and ACP sessions share the transcript, reasoning/tool-card runtime, disclosure/scroll behavior and presentation actions. ACP tool cards default to generic protocol-level rendering, with optional agent-specific or [external plugins](card-plugin-api.md#harness-targets-and-shared-runtime). Unsupported rich content is shown as literal JSON/text rather than inferred into a different tool schema; consecutive content blocks are retained independently.

Supported agent-advertised selectors appear through **ACP session options…**. Model, thinking and mode controls appear in the Status area only when the agent advertises their corresponding categories. Mode names and meanings belong to the agent. Other selectors remain in ACP session options. Changes are available while idle; working-turn configuration updates do not leave controls disabled afterward. The POC also accepts legacy ACP model/mode selectors. Advertised slash commands appear in composer completion and are sent as ordinary ACP prompts. Unadvertised slash commands are blocked locally, not accidentally forwarded to a model.

Session sidebar and Switch session include both backends. ACP rows and the Project bar identify the agent/ACP POC. Application commands such as Settings, themes and plugin reload remain Nimrod operations; Pi-only MCP inspection is not offered for ACP sessions.

## Persistence and current limits

**ACP POC sessions are in-memory in Nimrod, not guaranteed temporary sessions in the agent.** Close, reload or quit discards Nimrod's transcript, draft and pop-outs. Close asks for confirmation. The agent may retain its own history; Nimrod neither deletes nor discovers it.

Resume session, saved-history deletion and Restart remain Pi-only. The POC does not implement ACP history loading/discovery, attachment sending, client-hosted filesystem/terminal services, login/elicitation flows or all protocol extensions. Agents must be able to execute their own tools without those client services. No Copilot SDK backend or in-place backend switching is implemented.

There is no real-agent or native platform acceptance yet. Intended platform direction remains macOS first, Linux next and possibly Windows later; this POC does not establish per-platform parity.
