# MCP inspector

**Status: read-only first version implemented; added fixtures have not been run. Native acceptance pending.** User guide: [MCP inspector](../../../../docs/mcp.md).

## Specification

Bare `/mcp` and the bindable `mcp` palette action open a session-scoped inspection page in the existing command interaction. Composer submission clears only the submitted command; the palette/shortcut entry preserves the draft. Images with slash commands retain the existing rejection rule. Ordinary `/mcp` subcommands remain Pi commands. Bare inspection causes no pending user turn, recency bump, queue insertion, Send auto-follow, model request, or transcript navigation. Inspection remains available during main-agent work.

The page presents searchable server rows, attention-first stable ordering (failed, needs sign-in, disconnected), selected-server details, and explicit Refresh. Details retain full reported connection diagnostics as plain text. Counts are Pi-reported, and missing counts are unavailable rather than inferred zero. Exposure is server-level, not a claim about individual tool availability. Configuration diagnostics/overridden registrations occupy a separate selectable detail row.

Arrow, hover and click select details. Enter does not invoke row actions. Back returns to commands, Escape dismisses the whole interaction, and prior focus is restored by the shared palette lifecycle. Dismissal/Back/newer pages invalidate late presentation; session disconnect, restart and disposal cancel only that session’s current inspector. Errors close the inspector and use the originating session’s shared notice surface. A successful fresh report resolves only the inspector’s own previous failure, not server/startup warnings.

## Pi boundary and transport

There is no separate MCP client, config reader, subprocess, upstream change, or extension installation. Pi remains authoritative. Current built-in Pi exposes status in RPC mode through an informational `notify` from `/mcp`, not a structured MCP RPC endpoint. Before dispatch, query `get_commands` and require command `mcp`, source `extension`, sourceInfo.path `builtin:mcp`. Disabled/replaced integrations are rejected before a prompt can reach a model.

The session sends the read-only `/mcp` control through ordinary `prompt` RPC with `streamingBehavior: steer`. Only while that request is active, consume one info notification matching the complete known built-in status grammar. Preserve line boundaries while removing terminal formatting. Unrelated info, warning and error notifications retain ordinary notice routing. Capture synchronously in ordered event delivery before the prompt response. Require disposition `handled` plus a recognized report; do not infer success from an acknowledgement alone.

Concurrent inspection requests share one in-flight task. Refresh is explicit; no background polling. Canceled pages do not display, announce, reopen or report late results. Already-issued read-only status work may finish after cancellation. No automatic retry/replay. Ambiguous delivery or unrecognized handled output locks further inspection for that PiSession until explicit Restart (or a new connection); definite RPC rejection does not. This prevents a late uncorrelated notify from being adopted by a subsequent query.

Because notify has no originating command ID, this is a narrow compatibility adapter, not a general structured extension UI protocol. Unknown formats fail closed and are not silently classified. Do not extend the generic notice renderer with text-based MCP heuristics. The adapter understands the current installed Pi built-in status format; replacement integrations need their own concrete contract.

## Limits

Read-only snapshot only: no tools/schema list, per-tool exposure, source/scope, transport/config details, stderr tail beyond the report, reconnect, OAuth, enabled-state or exposure editing. Do not read credential-bearing configs or launch another MCP connection to fill those gaps. Startup warning text is harness-authored and stays unchanged. Refresh does not resolve or dismiss that warning.

## Code and fixtures

- `src/pi/mcp-status.ts`: strict built-in provenance and status parser, preserving raw report and diagnostic text.
- `src/pi/session.ts`: shared query task, ordered notify capture, handled-disposition verification, no-replay guard.
- `src/pi/webview-client.ts`: bare-command interception before ordinary Send effects.
- `src/main.ts`: session-bound action, row projection, current-owner guards, inspector cancellation and owned notices.
- `src/command-palette.ts`: shared inspection page and details region; existing dismissal/focus/generation lifecycle.
- `src/keybindings.ts`: unbound `mcp` action; `src/workspace.css`: bounded details and rows without modal-shell overrides.
- `test/mcp-status.test.ts`: formats, counts, multiline text, unavailable/replaced integration, unrelated notifications, busy inspection, shared task, disconnect and no replay.
- `test/command-palette.test.ts`: safe text, detail selection, Enter, Refresh, Escape/focus and stale-page rejection.
- `test/native-view.test.ts`: no model prompt post, pending turn, recency or auto-follow for bare `/mcp`; existing controls/validation rules.
- `test/shell.test.ts`: palette/composer entry wiring, draft preservation, attention-first detail projection, absence of status notices and disconnect cancellation.

Fixtures were added but not run. No builds, checks, live MCP calls or app launch performed for implementation. Native macOS visual/focus/real-Pi acceptance and Linux behavior remain unverified. When validation is requested, use the repository’s explicit-validation workflow; fixtures alone do not establish native acceptance.
