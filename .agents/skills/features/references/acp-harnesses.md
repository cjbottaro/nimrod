# Supporting ACP harnesses

**Status: generic ACP foundation retained; Copilot-specific ACP integration removed.**
Earlier ACP baseline validation does not cover this cleanup. Updated fixtures
are unrun; installed-agent/native acceptance remains pending.
User guide: [ACP sessions](../../../../docs/acp.md).

## POC workstream and abandonment checkpoint

The original POC used `feature/acp-foundation` in `.worktrees/acp-foundation/`.
The retained `checkpoint/pre-acp-poc` branch points to `784e80f`; `a3e1919`
is the merged isolated foundation. These historical checkpoint instructions do
not override ordinary task-worktree/local-merge rules for subsequent work.
Never reset/discard unrelated work to abandon ACP: retain worktrees/branches and
explicitly revert selected merged commits. Cleanup requires separate authorization.

## Scope and integration boundary

- Pi and [Copilot](copilot-sdk.md) remain bespoke integrations. Generic ACP is a
  capability-driven fallback for custom agents, not a universal internal protocol.
- ACP profiles are immutable literal executable/args/env configurations. No built-in
  Copilot preset, durable ACP identity, project-history association, history source,
  deletion source or Copilot-specific card adapter remains.
- Custom sessions are runtime-only, including profiles named `copilot`. Their
  reported session IDs do not become saved Nimrod identities or draft scopes.
  The shell creates through `session/new`; no saved ACP row is restored.
- Existing old layout records are ignored, not converted into SDK sessions.
  Old draft files and agent-owned history are not deleted or migrated.
- Shared mounted views, optimistic Send, focus, scroll, disclosures, notices and
  navigation retain their existing consumer contracts. Never fabricate Pi events
  or weaken Pi behavior to accommodate ACP.
- Generic ACP load/list/delete protocol primitives remain for future integrations;
  no current custom-agent persistence/history/deletion product path uses them.

## Command palette ownership

One Nimrod-owned palette and dispatcher owns project/session actions.
**New session** stays Pi-default; **New Copilot session** uses the SDK;
**New ACP session…** offers a custom JSON profile only. `new-acp` and
`acp-options` are bindable actions with empty defaults. Supported selectors are
session-bound; stale/canceled choices never act on another session.
Agent-advertised slash commands stay in composer completion, not Nimrod actions.
Switch includes custom sessions; Resume/Delete aggregate Pi and Copilot only.
MCP inspection and Restart remain Pi-specific.

## Current foundation

- `src/acp/connection.ts`: ordered bidirectional JSON-RPC. Result callbacks and
  incoming handlers begin synchronously in wire order; waiting/replying is async.
  IDs are reserved before handlers run; duplicate IDs/malformed records fail closed.
  Explicit rejection differs from uncertain delivery; never retry automatically.
  Disconnect rejects pending work, aborts handlers and suppresses late replies.
- `src/acp/client.ts`: ACP v1 with empty advertised client capabilities.
  One new/loaded session per connection; capability-gated generic protocol methods.
  Startup/configuration deadlines are 20s; prompts complete the whole turn and have
  no acceptance timeout. Early unknown-identity buffering is bounded at 128 updates/
  16 MiB; known replay is delivered directly.
- `src/acp/session.ts`, `tool-state.ts`: direct shared presentation projection,
  immutable null/omission-aware tool/permission patches, retained rich literal data,
  interrupted-tool finalization and ordered configuration application.
  Busy sends are not synthetic queues or steering.
- `src/acp/profiles.ts`, `session-lifecycle.ts`, `src/main.ts`: frozen custom
  profiles and runtime-only lifecycle, independent owned start/stop/disconnect,
  no durable reference/key/draft scope. Environment/credentials are never persisted.
  Close confirms state loss and stops only the owning process.
- `src-tauri/src/acp.rs`: separate window/token-scoped owned stdio host.
  Canonical project cwd; literal args/env; optional Runtime Node PATH enrichment.
  Named-operation validation retains exact load IDs, project-filtered list/cursors
  and explicit delete IDs. Stdout is bounded at 16 MiB/record; stderr at 64 KiB/line
  with a bounded diagnostic tail. Ordered stdin has a 5s deadline without blocking
  output or Stop. SIGTERM/kill escalation observes exit; failed stop retains
  reservations. Reload cleanup gates ACP creation, never Pi/Copilot startup.
- `src/acp/card-plugins.ts`: generic protocol fallback only; Copilot adapters live
  in `src/copilot/card-plugins.ts` and accept SDK sources only. External plugins
  retain explicit ACP targets and the same public visual components.
- Permissions stay in their owning conversation with exact offered choices;
  Stop/disconnect/completion abort pending decisions and suppress late approvals.
  Filesystem/terminal/auth/elicitation client services remain unsupported.

### Compact command permissions

Execute requests show one compact command summary and exact command text,
deduplicating repeated metadata without losing distinct commands. Fetch requests
show a supported URL. Offered action buttons precede a collapsed Raw details
disclosure retaining complete native data. Unsupported shapes keep literal details;
partial requests resolve prior tool metadata synchronously in arrival order.
Background requests never steal focus or navigate.

## Fixtures and remaining acceptance

Generic protocol/client/session/card/native fixtures remain, including offline
`test/fixtures/acp-agent.mjs`, custom-profile shell isolation and
`test/browser/acp-sessions.spec.ts`. Browser sessions now launch custom profiles,
not saved Copilot records. Copilot inspection/web fixtures exercise SDK data.
Old Copilot ACP discovery/deletion fixtures were removed or ported to SDK.
These changes have not been tested, checked, built or launched.

Follow [Pi regression protection](harness-presentation.md#regression-guardrails-and-evidence),
[notice ownership](error-presentation.md), [optimistic interaction](architecture.md#optimistic-interaction-policy)
and window/token ownership. Native macOS/Linux acceptance and actual custom-agent
interoperability remain unverified. No live requests, user-history mutation,
OS process scans or external-writer exclusion claims. Tests/builds/launches require
explicit authorization under repository policy.
