# Supporting ACP harnesses

**Status: product integration planned; isolated protocol foundation implemented, not validated or wired into the app.** Pi remains Nimrod's only usable harness. This reference records decisions, implementation stages and current foundation boundaries, not a Copilot compatibility guarantee. The [features skill](../SKILL.md#harness-integration-direction) owns the broader direction, including potential bespoke SDK integrations.

## Goal and sequence

Implement a reusable Agent Client Protocol (ACP) client, with **Copilot CLI as the first concrete acceptance target**. Use the existing protocol rather than inventing a universal harness protocol. Keep Pi's native integration; do not force Pi through ACP or translate ACP events into fake Pi events.

| Stage | Scope and completion boundary |
| --- | --- |
| 1. Isolated protocol foundation — implemented, fixtures not run | ACP-only JSON-RPC and new-session/text-turn/permission handling. No app imports or native launch. See [current foundation](#current-foundation). |
| 2. Native vertical slice — next | Add named, owned stdio launch/IPC alongside Pi; literal executable/args/environment, framing/byte bounds, canonical cwd validation, observed shutdown and Copilot preset. Connect an experimental ACP conversation without changing Pi's transport. |
| 3. Shared rendering and public plugin components | Introduce explicit presentation boundaries, harness/agent-scoped plugins and generic ACP fallback. Exercise public shared components from both bundled and external plugins. Preserve Pi transcript behavior through targeted fixtures. |
| 4. Shell and palette integration | Immutable session backend/profile identity, capability-aware controls, explicit creation default/selection, mixed-session navigation, permissions and notice ownership. Do not silently migrate existing Pi identities/settings/drafts. |
| 5. History and richer capabilities | Implement supported discovery/loading/replay, configuration, commands and attachments; document unavailable temporary/rename/deletion semantics rather than emulate them. |
| 6. Interoperability and acceptance | Validate Copilot, then a second ACP agent, with explicit native/platform evidence and versioned capability gaps. |

Each stage is a bounded task/worktree. Add fixture coverage with the implementation, but run checks/tests/builds only when requested. Reassess after the native vertical slice before committing to the full compatibility scope. A tighter Copilot SDK backend remains a possible follow-on only for identified gaps.

## Recorded product decisions

- **A session's backend is immutable:** Pi stays Pi; an ACP session stays tied to its configured agent/profile. Changing model or thinking effort does not change the backend. A future SDK integration is a different backend, not an in-place switch or second concurrent controller. Profile edits must not silently redirect saved sessions to a different agent.
- **Bespoke behavior is intentional:** Pi keeps Pi-specific controls and semantics; ACP exposes as much supported ACP functionality as possible. Do not reduce both to a lowest-common-denominator chat interface.
- **ACP supplies reusable protocol behavior, not identical agents:** implement the standard once; capability differences and tool payloads do not justify duplicating the ACP transport per agent. Agent-specific work should primarily be optional presentation improvements.
- **The transcript runtime is shared; plugin sets need not be.** Pi Bash and Copilot shell plugins can be separate adapters using the same public visual components. Generic ACP cards must remain usable with an unknown agent and no bespoke plugins.
- **External authors get equal supported building blocks.** Bundled plugins must use the same public components/API available to external plugins, not private rendering helpers. The [card-plugin reference](card-plugins.md#planned-multi-harness-plugin-boundary) owns this planned contract.

## Command palette ownership

Keep one Nimrod-owned palette and dispatcher, with explicit command ownership rather than one palette per harness:

| Command scope | Intended behavior |
| --- | --- |
| Application/project | Settings, themes, Open project, sidebar visibility and plugin reload remain Nimrod operations, independent of selected harness. |
| Cross-session coordination | New, Switch, Resume and Delete sessions remain common entry points; each integration supplies supported operations and metadata, not a universal deletion/resume algorithm. |
| Selected session | Model/thinking and other operations target that exact session and its capabilities. Pi-only commands remain Pi-only; ACP commands must be advertised/supported. |

- New needs an explicit harness/profile choice or configured project default. The precise chooser/default UX remains to be implemented; do not silently derive the new backend from whichever session is selected.
- Switch lists all open sessions with harness/agent identity, regardless of connectivity or capabilities.
- Resume can aggregate supported history sources with harness labels. A source failure must not hide working Pi history. Distinguish remembered resumable sessions from complete agent-owned discovery.
- Delete retains harness-specific review and safeguards. Pi's exact-file/tree behavior must not become an assumed ACP capability.
- Keep agent-advertised slash commands in composer completion initially, not automatically in the top-level Nimrod palette. Any future palette exposure needs namespacing and the existing bindable-action/dispatcher contract; agent command names cannot replace application actions.
- A picker stays bound to its originating session through async results, selection changes and cancellation. Stale results cannot act on the newly selected session or reopen canceled interactions. Unsupported shortcuts do not fall through into destructive text editing.

Use the existing [command interaction](command-interactions.md) lifecycle and [keybinding](keybindings.md) registry. This is planned ownership/routing, not implemented mixed-harness palette behavior.

## Proposed integration boundary

- Add a separate ACP integration alongside Pi, sharing only presentation/session-shell boundaries demonstrated by the concrete integrations: identity/lifecycle, presentation updates, send/cancel, capabilities and history discovery/loading.
- Reuse project windows, mounted conversation areas, Session sidebar, drafts, notifications and generic transcript presentation where their contracts apply. Keep harness-specific reducers, control semantics and specialized tool renderers separate.
- Prefer an owned stdio subprocess initially. Configure an executable, literal arguments and environment, with a Copilot preset (`copilot --acp --stdio`). Do not introduce a persistent daemon or extra Node backend merely to use a TypeScript SDK.
- Preserve ordered delivery across responses, streaming updates and history replay. Do not reuse Pi's request-result meaning or ordinary RPC deadlines blindly: an ACP prompt response can describe completion of the whole turn, not merely submission acceptance.
- Saved identities must be qualified by the configured harness/profile and project, not treated as Pi file paths. Design migration for app bookkeeping, draft scopes, reservations and pop-out ownership without rewriting harness-owned histories.

These are design constraints, not a finalized internal interface or code map. Extract shared interfaces during the concrete implementation, rather than building a framework in advance.

## Capability-aware behavior

Negotiate protocol versions and capabilities. Treat omitted capabilities as unsupported, and verify actual agent/version behavior before documenting compatibility.

| Area | Intended behavior |
| --- | --- |
| Transcript | Render streamed text, supplied reasoning, tool updates and supported structured content without inventing unavailable detail. Preserve tool identity, disclosures, mounted nodes and reader intent. |
| Permissions | Present agent-provided choices and correlate responses to their exact request/session. Define cancellation, background-session routing and disconnect behavior; do not silently approve. |
| Send and Stop | Use ACP prompt/cancel semantics. Do not emulate Pi steering or queues by aborting and replaying prompts. Define the busy-session interaction contract explicitly. |
| Commands | Use the agent-advertised command list. Do not assume Pi commands or forward unadvertised terminal-only commands as executable actions. |
| Configuration | Render supported agent-provided configuration options, including model/mode/thinking selectors where exposed. Do not assume fixed Pi model or thinking semantics. |
| Attachments | Enable image and other rich prompt content only when supported; local validation must precede submission. |
| History | Load/replay only when supported. Distinguish remembered Nimrod sessions from a complete agent-owned catalog; discovery and deletion require their own supported methods and verification. |
| Persistence | Do not promise persistent, temporary, rename, restart or session-tree deletion semantics merely because a new session can be created. Establish each supported contract explicitly. |
| Metrics | Display only reported usage/cost/context information; unavailable data is not zero. |

ACP session loading can replay history through the same update stream used for live work. Keep replay distinct from new activity: it must not send prompts, trigger completion alerts, duplicate user turns or repeat local Send/navigation effects. Loading history and reconnecting without replay are different operations; use only methods the agent advertises and Nimrod can present correctly.

ACP also supports **client-provided filesystem and terminal services**. Initially advertise neither and target agents that execute their own tools. Broader compatibility may require narrow native implementations later; this does not imply an integrated terminal UI. Never advertise unimplemented client capabilities. Authentication requirements and terminal-dependent login flows likewise need explicit compatibility boundaries.

## Existing contracts to preserve

- Harnesses remain authoritative for history, tools, configuration and semantic lifecycle. Nimrod owns presentation, local drafts, native windows and owned processes.
- Follow the [optimistic interaction policy](architecture.md#optimistic-interaction-policy): local Send feedback is immediate after local validation; late errors annotate the originating operation without restoring drafts, repeating navigation or replaying uncertain delivery.
- Preserve [transcript interaction](transcript-interaction.md), [card disclosure behavior](transcript-cards.md), [session navigation](session-navigation.md) and [notice ownership](error-presentation.md). Any deliberate capability-dependent behavior change must update its canonical specification before implementation.
- Native ownership stays window/token-scoped; stop only owned children and observe shutdown before replacement. No external-writer exclusion claims.
- Keep process launch, paths and host services portable: macOS first, Linux next, possible Windows later. Do not infer platform acceptance from protocol fixtures.

## Current foundation

- `src/acp/connection.ts`: isolated, dependency-free ACP JSON-RPC record boundary. Outbound result callbacks apply synchronously before later wire events. Incoming/outgoing ID spaces are independent; duplicate active incoming IDs and malformed records fail closed. Explicit RPC errors differ from uncertain connection/write failure; no automatic retry. Disconnect rejects pending operations, aborts incoming handlers and suppresses late replies/events.
- `src/acp/client.ts`: deliberately limited ACP v1 client, one new session per connection. Negotiates v1 with empty client capabilities, preserves returned capability/configuration records, sends text, delivers ordered raw session updates, handles whole-turn completion, sends cancel once and remains working until authoritative completion. Busy sends are rejected locally rather than queued/steered implicitly.
- Permission callbacks may select only an offered option. Missing handlers, callback errors, invalid choices and cancellation fail closed. Cancel/disconnect/turn completion abort pending permission UI; late approval cannot revive a canceled request. Unimplemented filesystem/terminal/auth methods return method-not-found and are not advertised.
- Some agents send updates before the new-session response. The client buffers at most 128 updates, verifies their session identity and releases them synchronously on identity confirmation; overflow disconnects rather than dropping updates. Future native framing/aggregate bounds remain required.
- `test/acp-connection.test.ts` and `test/acp-client.test.ts`: authored offline record fixtures for ordering, negotiation, identity, cancellation, permission selection/late results, unsupported methods, malformed records, bidirectional IDs and uncertain delivery. **Not run.** No native subprocess fixture or actual Copilot/second-agent evidence exists yet.

The host must deliver decoded records and writes in order, enforce byte/framing limits, validate canonical cwd, manage token/window ownership, stop on connection failure and provide lifecycle deadlines for startup. The foundation has no request deadlines (in particular no Pi-style prompt-acceptance timeout). It forwards extensible update records; variant-specific validation and presentation are future work, not an existing rendering guarantee. No rich-content sending, authentication flow, history, configuration mutation, subprocess launch or UI integration is implemented. Nothing in the app imports this foundation; Pi source, native commands, saved formats and UI paths are unchanged.

## Pi regression protection

No claim of zero regression risk: shared rendering, composer, storage/identity, palette and native ownership are the risk boundaries. Preserve Pi's transport/reducer/startup/queue/model controllers; do not refactor them to accommodate ACP. Add separate ACP native operations rather than broadening Pi's named-operation validation. Existing Pi sessions/defaults stay Pi, and old draft/session identities must keep working without destructive migration.

For each shared change, extend the relevant Pi fixtures and add mixed-harness cases: switching while streaming, background permission/completion, modal focus, draft retention, disclosure/scroll preservation, saved identity, Close/Restart and independent owned shutdown. Run authorized `mise run check` and offline browser validation where applicable before claiming regression evidence; fixture results are distinct from native acceptance. Prefer limited temporary duplication to a speculative shared abstraction that changes Pi semantics.

## Acceptance work before shipping

Use fixture agents for negotiation, unsupported capabilities, bidirectional requests, permission cancellation, malformed/disconnected streams, ordered replay/live updates, busy sends, cancellation completion, late old-generation events and owned-child shutdown. Cover session identity isolation, history failures without new-session fallback, and draft/selection preservation. No automatic retry after uncertain delivery.

Validate actual Copilot compatibility separately from fixtures, then a second agent separately. Record tested agent/protocol versions, platforms and capability gaps in the [verification reference](verification.md). No live paid requests, user-session mutation, tests, builds or app launches without the authorization required by repository policy.

When app support is implemented, add user-facing setup/limitations documentation and update the affected internal feature contracts. This foundation does not change user-visible behavior and does not warrant a changelog entry or user setup guide yet.

## Upstream references

Recheck protocol and agent support during implementation; these links are design inputs, not pinned compatibility evidence.

- [ACP initialization and capability negotiation](https://agentclientprotocol.com/protocol/initialization)
- [ACP session setup and history replay](https://agentclientprotocol.com/protocol/session-setup)
- [ACP session configuration options](https://agentclientprotocol.com/protocol/session-config-options)
- [Copilot CLI ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
- [Copilot SDK](https://github.com/github/copilot-sdk)
