# MCP inspector

Run **`/mcp`** in the composer, or choose **MCP servers…** in the command palette, to inspect the visible session’s MCP servers. The palette entry leaves your draft untouched; submitting `/mcp` consumes only that command. The action has no default shortcut, but you can assign one in [Keybindings](keybindings.md).

- Search server names, connection states, exposure, or reported diagnostics.
- Use arrow keys, hover, or click to select a server. Its details appear beneath the list; Enter does not execute an operation or close the inspector.
- Servers needing attention appear first. Details show the reported connection state, exposure, tool count when available, and complete connection error text supplied by Pi.
- **Refresh** explicitly requests another snapshot. **Back** returns to commands; **Escape** closes the interaction and restores prior focus.

Inspection works while the main agent is working. It does not request a model response, add a conversation turn, move the session in the sidebar, or navigate the transcript. Streaming continues underneath the inspector. The report goes into the inspector, not the session-issue list; independent startup warnings and other extension notices remain unchanged.

## First-version limits

This is a **read-only snapshot**, not a live MCP manager. It supports Pi’s built-in MCP integration only. Replacement MCP extensions are not interpreted or run by the inspector.

Pi’s RPC `/mcp` report exposes server state, server-level exposure, counts, and diagnostics, but not individual tool descriptions, per-tool exposure overrides, configuration sources, transport details, or stderr beyond what that report includes. A connected server’s tool count does not imply all its tools are declared to the model. A missing count is shown as unavailable, not zero.

There are no reconnect, sign-in, enable/disable, or configuration-editing buttons in this version. Existing explicit `/mcp` subcommands continue through Pi’s normal command path. Inspection itself does not fix connection problems or modify Pi configuration.

If status delivery becomes uncertain or the report format is unrecognized, Nimrod does not automatically replay the request. It reports the failure to the originating session; restart that session before another inspection attempt after an uncertain status request.

Native appearance, focus and installed-Pi behavior still need user validation; Linux behavior is intended, not platform-verified.
