# ACP sessions (experimental POC)

Generic Agent Client Protocol support is an experimental option for custom agents.
Built-in [Copilot sessions](copilot.md) use the official SDK, not this integration.

## Start an ACP session

Open a project, then **⌘/Ctrl+Shift+P → New ACP session… → Custom ACP agent…**.
The action is unbound by default; configure a shortcut in [Keybindings](keybindings.md).

Enter a literal JSON launch profile:

```json
{
  "name": "My agent",
  "command": "/absolute/path/to/agent",
  "args": ["--acp"],
  "env": {}
}
```

`command` is an executable name on PATH or an absolute path; `args` is an array,
not a shell command. Profiles and their environments are not saved. If desktop
discovery fails, use an absolute path. Nimrod prepends the configured Runtime Node
directory when available; native agents do not require Node. For a JavaScript
entry point, use Node as the command and the script as its first argument.

The agent uses the project's exact directory. Starting it sends no prompt, but
the agent still performs its normal startup/configuration. Sending uses its normal
provider/account. Authentication and tool execution belong to the agent.

**New session**, **New named session** and **New temporary session** remain Pi
operations. Each session's backend and launch profile are fixed.

## Send, Stop and permissions

Text Send immediately clears the composer and previews the user turn. Authoritative
events reconcile it without replaying uncertain delivery or restoring sent text.
While working, Enter keeps the newer draft: there is no steering or queue.
**Stop** requests turn cancellation and waits for the agent's completion response.

Permissions stay inside their owning conversation with the agent's exact choices
and **Cancel request**. Command requests show a compact command preview; fetch
requests show their URL. Collapsed **Raw details** retain native metadata. Other
operations keep literal details. Background requests never switch sessions, open
global dialogs or take focus. Stop, disconnect and Close cancel pending choices;
nothing is silently approved.

## Reading and configuration

ACP uses the shared transcript, disclosures, scroll behavior and generic tool
cards. [External plugins](card-plugin-api.md#harness-targets-and-shared-runtime)
can provide agent-specific presentation. Unsupported rich content remains literal.

Only advertised configuration selectors and slash commands appear. Model/thinking
and mode changes require idle; **ACP session options…** exposes additional supported
selectors. Agent commands do not replace Nimrod's own command-palette actions.

## Close and limitations

Custom sessions are runtime-only. **Close** confirms before stopping their owned
agent and discarding Nimrod's in-memory transcript, draft and pop-outs. The agent
may retain its own history; Close does not delete it. Reopening the app does not
restore custom sessions. After disconnection, create a new session explicitly.

Saved-history discovery, Resume, deletion, Restart and image sending are not
available for custom agents. Client-hosted filesystem/terminal services,
login/elicitation and some protocol extensions are not implemented.

Generic ACP fixtures do not establish installed-agent or native acceptance.
macOS is first, Linux next; Windows remains a possible future target.
