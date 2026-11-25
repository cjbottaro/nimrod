# MCP inspector

User guide: [MCP inspector](../../../../docs/mcp.md).

## Specification

**MCP servers…** is a bindable session action with no default shortcut. Connected Pi and Codex sessions contribute it. The command palette, shortcut and Status area button route to the same action. The button is a launcher, not an inferred health indicator; no background queries or polling. `/mcp` and its argument forms are not composer commands; reject them locally and retain the draft. Other slash invocation and completion are unchanged.

The shared inspection page renders searchable rows and literal selected-server details. Arrow, hover and click select details; Enter does not invoke row actions. Refresh replaces the page generation, Back returns to commands, and Escape dismisses and restores focus. Dismissal, Back, session hide, disconnect and replacement suppress stale results; an issued read can finish without updating the UI. Errors close the page and use the originating session’s notice surface. A fresh report resolves only the inspector’s own previous failure. Inspection preserves the draft, Send recency and transcript reader intent, creates no Command card and is usable while the agent works.

## Concrete boundaries

- **Pi:** Query `get_commands` before dispatch and require exact built-in `mcp` provenance (`builtin:mcp`). Use the read-only internal `/mcp` control through `prompt` RPC with `streamingBehavior: steer`. Capture one complete known info-notify report in ordered delivery and require handled disposition. Concurrent requests share an in-flight task. Preserve unrelated notices. Ambiguous delivery or an unrecognized handled report locks the inspector until explicit Reload or a fresh connection. This is a narrow compatibility adapter, not a general prose parser. Rows put failed, needs sign-in and disconnected servers first; counts describe server-level exposure only. No replacement commands, independent MCP connections or config readers.
- **Codex:** Read exact-thread `mcpServerStatus/list` with full details and bounded native request validation. Reject repeated cursors instead of displaying partial reports. Stop requesting further pages if the page/session changes. Present runtime state and authentication independently, alongside reported tools, resources and diagnostics. Full discovery may contact configured servers. There is no inferred health state or native auth mutation.
- **Copilot:** No inspector until structured, reliably scoped server data is available. Existing text report evidence is not a server catalog.

No sign-in, reconnect, scope changes, editing or configuration/auth storage. Do not treat the inspector as a separate MCP client.

## Code and fixtures

`src/mcp-inspector.ts` owns the session-bound shared page lifecycle; concrete Pi and Codex `integration-inspection.ts` modules map validated reports. `src/main.ts` mounts the Status area launcher and uses the existing session-action dispatcher. `src/keybindings.ts` registers `mcp`. `test/mcp-status.test.ts` exercises Pi’s report transport and `test/codex-session.test.ts` covers scoped pagination. `test/shell.test.ts` covers action routing, draft/focus preservation and rejection of retired slash text; `test/command-palette.test.ts` covers inspection page behavior. See [verification status](verification.md) for executed evidence; native acceptance remains pending.
