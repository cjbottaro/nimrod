# MCP inspector

Choose **MCP servers…** in the command palette or click **MCP servers…** in the Status area of a connected Pi or Codex session. You can assign a shortcut in [Keybindings](keybindings.md); there is no default. `/mcp` is not a Nimrod composer command.

- Search the reported servers and select a row to see its details. Selecting a server does not run an operation.
- **Refresh** requests another snapshot. **Back** returns to commands; **Escape** closes the inspector and restores prior focus.
- Inspection preserves your draft and works while the agent is working. It does not send a model request, add a turn, change session recency, or navigate the transcript.

Pi’s built-in MCP integration reports connection state, exposure, counts, and diagnostics. It does not report individual tools, and a server’s tool count does not imply all its tools are exposed to the model. Missing counts are shown as unavailable. Replacement Pi MCP extensions are not interpreted or run by the inspector. If Pi’s status delivery becomes uncertain or unrecognized, reload the session before trying again; Nimrod does not replay the request.

Codex reports runtime and authentication state separately, plus tools and resources. Inspecting them can contact configured servers. Copilot does not currently offer the inspector.

The inspector is read-only. Use the harness TUI for sign-in or reauthentication and the harness’s own tools for configuration changes. Native validation is pending.
