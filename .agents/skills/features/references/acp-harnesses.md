# Supporting ACP harnesses

**Status: planned; not implemented.** Pi remains Nimrod's only implemented harness. This reference records the proposed ACP integration, not current product behavior or a compatibility guarantee. The [features skill](../SKILL.md#harness-integration-direction) owns the broader direction, including potential bespoke SDK integrations.

## Goal and sequence

Implement a reusable Agent Client Protocol (ACP) client, with **Copilot CLI as the first concrete acceptance target**. Use the existing protocol rather than inventing a universal harness protocol. Keep Pi's native integration; do not force Pi through ACP or translate ACP events into fake Pi events.

1. Deliver an ACP vertical slice against Copilot: launch, initialize, create a session, stream text/tool activity, handle permissions, send and cancel.
2. Add capability-aware configuration, commands, supported attachments and saved-session behavior; establish lifecycle and replay correctness with fixtures and explicit native acceptance.
3. Exercise a second ACP agent before claiming broad interoperability. Generic launch configuration is not evidence that every ACP agent works.
4. Consider a tighter Copilot SDK integration only for identified gaps. It is a possible follow-on, not a prerequisite or committed implementation.

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

## Acceptance work before shipping

Use fixture agents for negotiation, unsupported capabilities, bidirectional requests, permission cancellation, malformed/disconnected streams, ordered replay/live updates, busy sends, cancellation completion, late old-generation events and owned-child shutdown. Cover session identity isolation, history failures without new-session fallback, and draft/selection preservation. No automatic retry after uncertain delivery.

Validate actual Copilot compatibility separately from fixtures, then a second agent separately. Record tested agent/protocol versions, platforms and capability gaps in the [verification reference](verification.md). No live paid requests, user-session mutation, tests, builds or app launches without the authorization required by repository policy.

When implemented, add user-facing setup/limitations documentation and update the affected internal feature contracts. Until then, this remains internal planning only.

## Upstream references

Recheck protocol and agent support during implementation; these links are design inputs, not pinned compatibility evidence.

- [ACP initialization and capability negotiation](https://agentclientprotocol.com/protocol/initialization)
- [ACP session setup and history replay](https://agentclientprotocol.com/protocol/session-setup)
- [ACP session configuration options](https://agentclientprotocol.com/protocol/session-config-options)
- [Copilot CLI ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
- [Copilot SDK](https://github.com/github/copilot-sdk)
