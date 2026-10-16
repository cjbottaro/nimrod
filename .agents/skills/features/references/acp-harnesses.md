# Supporting ACP harnesses

**Status: ACP POC wired into the app in source; validation/native acceptance pending.** Pi remains the primary integration. This reference records decisions, implementation stages and POC boundaries, not a Copilot compatibility guarantee. User setup/limitations: [ACP sessions](../../../../docs/acp.md). The [features skill](../SKILL.md#harness-integration-direction) owns the broader direction, including potential bespoke SDK integrations.

## POC workstream and abandonment checkpoint

Continue all POC stages on `feature/acp-foundation` in `.worktrees/acp-foundation/`, with incremental commits and no intermediate merges into `main`. Sub-worktrees, if needed, integrate into this task branch first. The retained local branch `checkpoint/pre-acp-poc` points to **`784e80f`**, the last commit before ACP implementation; **`a3e1919`** is the already-merged isolated foundation and the starting point for the rest of the POC. Do not reset/discard unrelated work to abandon the effort: leave the task worktree/branch intact and revert selected merged ACP commits explicitly if needed. No branch/worktree cleanup is authorized.

POC target: launch an owned ACP agent beside Pi, stream into the shared transcript/card runtime, submit/cancel text, choose permissions, switch/close independently and expose supported configuration/commands. Copilot is the first target, with a generic configurable launch profile. Saved ACP discovery/resume/deletion and attachments may remain explicit limitations. Live requests, checks and app builds/launches still require explicit authorization; code completion alone is not native compatibility evidence.

## Goal and sequence

Implement a reusable Agent Client Protocol (ACP) client, with **Copilot CLI as the first concrete acceptance target**. Use the existing protocol rather than inventing a universal harness protocol. Keep Pi's native integration; do not force Pi through ACP or translate ACP events into fake Pi events.

| Stage | Scope and completion boundary |
| --- | --- |
| 1. Protocol foundation — source implemented | ACP-only JSON-RPC, new-session/text-turn/permission handling. See [current foundation](#current-foundation). Fixtures not run. |
| 2. Native vertical slice — source implemented | Separate owned stdio host/named IPC, literal launch configuration, framing/byte bounds, canonical cwd validation, observed shutdown and Copilot preset. Native fixtures authored, not run. |
| 3. Shared rendering/public components — POC source implemented | Shared conversation-view entry, scoped plugins, generic ACP fallback and public presentation/shell helpers used by bundled and external fixtures. No claim of Pi rendering regression acceptance. |
| 4. Shell/palette — POC source implemented | Immutable runtime profile identity; explicit New ACP command alongside unchanged Pi-default New; mixed-session switching, inline permissions, advertised options/commands and independent Close. Saved ACP identities not implemented. |
| 5. History and richer capabilities — deferred | Supported discovery/loading/replay and attachments remain future work. The POC exposes select configuration/legacy model/mode controls and advertised commands, not every protocol feature. |
| 6. Interoperability and acceptance | Validate Copilot, then a second ACP agent, with explicit native/platform evidence and versioned capability gaps. |

Keep these stages as bounded commits in the single POC task worktree (the checkpoint/workstream policy above overrides the earlier separate-worktree-per-stage suggestion). Add fixture coverage with the implementation, but run checks/tests/builds only when requested. Reassess after the native vertical slice before committing to the full compatibility scope. A tighter Copilot SDK backend remains a possible follow-on only for identified gaps.

## Recorded product decisions

- **A session's backend is immutable:** Pi stays Pi; an ACP session stays tied to its configured agent/profile. Changing model or thinking effort does not change the backend. A future SDK integration is a different backend, not an in-place switch or second concurrent controller. Profile edits must not silently redirect saved sessions to a different agent.
- **Bespoke behavior is intentional:** Pi keeps Pi-specific controls and semantics; ACP exposes as much supported ACP functionality as possible. Do not reduce both to a lowest-common-denominator chat interface.
- **ACP supplies reusable protocol behavior, not identical agents:** implement the standard once; capability differences and tool payloads do not justify duplicating the ACP transport per agent. Agent-specific work should primarily be optional presentation improvements.
- **The transcript runtime is shared; plugin sets need not be.** Pi Bash and Copilot shell plugins can be separate adapters using the same public visual components. Generic ACP cards must remain usable with an unknown agent and no bespoke plugins.
- **External authors get equal supported building blocks.** Bundled plugins must use the same public components/API available to external plugins, not private rendering helpers. The [card-plugin reference](card-plugins.md#multi-harness-plugin-boundary) owns this contract.

## Command palette ownership

Keep one Nimrod-owned palette and dispatcher, with explicit command ownership rather than one palette per harness:

| Command scope | Intended behavior |
| --- | --- |
| Application/project | Settings, themes, Open project, sidebar visibility and plugin reload remain Nimrod operations, independent of selected harness. |
| Cross-session coordination | New, Switch, Resume and Delete sessions remain common entry points; each integration supplies supported operations and metadata, not a universal deletion/resume algorithm. |
| Selected session | Model/thinking and other operations target that exact session and its capabilities. Pi-only commands remain Pi-only; ACP commands must be advertised/supported. |

- The POC preserves **New session** as Pi-default and adds explicit **New ACP session…**, selecting Copilot or a custom literal JSON profile. Do not silently derive a new backend from the selected session. Configurable project defaults/profile persistence are deferred.
- Switch lists all open sessions with harness/agent identity, regardless of connectivity or capabilities.
- Resume can aggregate supported history sources with harness labels. A source failure must not hide working Pi history. Distinguish remembered resumable sessions from complete agent-owned discovery.
- Delete retains harness-specific review and safeguards. Pi's exact-file/tree behavior must not become an assumed ACP capability.
- Keep agent-advertised slash commands in composer completion initially, not automatically in the top-level Nimrod palette. Any future palette exposure needs namespacing and the existing bindable-action/dispatcher contract; agent command names cannot replace application actions.
- A picker stays bound to its originating session through async results, selection changes and cancellation. Stale results cannot act on the newly selected session or reopen canceled interactions. Unsupported shortcuts do not fall through into destructive text editing.

Use the existing [command interaction](command-interactions.md) lifecycle and [keybinding](keybindings.md) registry. `new-acp` and `acp-options` are registered project actions with empty defaults. Selected ACP configuration uses session-bound palette selections; each accepted selection closes before a subsequent page opens. Resume/Delete saved history still use Pi's existing catalog only; aggregate history remains planned.

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

- `src/acp/connection.ts`: independent JSON-RPC record boundary. Result callbacks apply synchronously before later wire events; incoming/outgoing IDs are independent. Malformed records/duplicate active incoming IDs fail closed. Explicit RPC errors differ from uncertain write/disconnection; no automatic retries. Disconnect rejects pending work, aborts handlers and suppresses late events/replies.
- `src/acp/client.ts`: ACP v1, one new session per connection, empty advertised client capabilities. Text prompts, ordered session updates, whole-turn completion/cancellation, supported configuration requests and permissions. Pre-identity buffering is capped at 128 updates/16 MiB; overflow disconnects explicitly. Busy sends never become synthetic queues/steering.
- `src/acp/session.ts`: ACP semantics adapted directly to shared display records, not Pi events. Local user echoes reconcile by renderer key. Tool IDs patch retained native metadata and supplied content; pending tools become interrupted on cancellation/disconnect. Configuration responses apply synchronously before later updates. Startup/configuration have 20s deadlines; prompts have no acceptance timeout. Unsupported rich content falls back to JSON/text. Plan/context updates are displayed; fuller rich content, cost and extensions remain follow-ons.
- `src-tauri/src/acp.rs`: separate `AcpHost`, `start_acp`/`write_acp`/`stop_acp`; window/token ownership, project-cwd validation and literal executable/args/env. Native outgoing operations are whitelisted separately from Pi; no session loading/deletion endpoint. Stdout 16 MiB/record, stderr 64 KiB/line with a bounded diagnostic tail; 5s stdin deadline; owned SIGTERM/kill escalation and observed exit. Failed shutdown retains the reservation. App Quit/window Close includes both hosts; neither scans OS processes. Webview reload separately reaps ACP children before enabling new ACP sessions, without making ACP availability a gate on Pi startup. Node PATH enrichment is optional for native agents.
- `src/acp/profiles.ts`, `src/main.ts`: frozen Copilot/custom profile identity at creation; no profile persistence. Pi-default creation/history remains untouched. ACP entries use runtime UUIDs and memory-only draft/pop-out scopes, excluded from Pi saved layout/history. This does not imply the agent disables its own persistence. Close confirms loss of Nimrod state without claiming agent-history deletion.
- `src/conversation-view.ts`: shared engine entry (legacy implementation remains in `src/pi/webview-client.ts`). The optional ACP view behavior disables Pi slash interception, busy steering/queue semantics and attachments, labels Stop for the owning agent, and hides unsupported preference controls. Pi omits this behavior and retains its existing branch. `src/acp/card-plugins.ts` supplies generic ACP fallback/optional Copilot shell adaptation; public component details belong to [card plugins](card-plugins.md#multi-harness-plugin-boundary).
- Permissions are inline in their owning conversation's interaction area, without focus/modal/navigation side effects. Only exact offered choices can select; absent UI, failures, invalid choices and cancellation fail closed. Stop/disconnect/completion abort pending UI and suppress late approvals. Client filesystem/terminal/auth/elicitation services are not advertised or implemented. The agent must already be authenticated and provide its own execution services.

### POC fixtures and evidence

`test/acp-connection.test.ts`, `test/acp-client.test.ts`, `test/acp-session.test.ts`, `test/acp-cards.test.ts`, mixed cases in `test/shell.test.ts`, native tests in `acp.rs`, and `test/browser/acp-sessions.spec.ts` are authored but **not run or type-checked**. The offline `test/fixtures/acp-agent.mjs` implements simulated ACP streaming, permission/configuration and cancellation without tools/providers/network/user-history writes; browser hosts substitute it for every ACP launch and keep Pi on the existing offline demo. The fixture file itself has not been executed for acceptance yet. External-plugin fixtures bundle/import the public shell helper and assert bundled shell entries avoid private rendering imports.

No app build/launch, installed-agent startup, live request or native platform acceptance has occurred. Source formatting is not validation. Requested validation must include `mise run check` and `npm run test:browser` because shared transcript/composer/scroll paths changed. Real Copilot and a second agent require separate explicit authorization/evidence. No ACP history loading/discovery, attachment sending, login/elicitation/client terminal/filesystem support, saved draft migration or SDK backend is implemented.

## Pi regression protection

No claim of zero regression risk: shared rendering, composer, storage/identity, palette and native ownership are the risk boundaries. Preserve Pi's transport/reducer/startup/queue/model controllers; do not refactor them to accommodate ACP. Add separate ACP native operations rather than broadening Pi's named-operation validation. Existing Pi sessions/defaults stay Pi, and old draft/session identities must keep working without destructive migration.

For each shared change, extend the relevant Pi fixtures and add mixed-harness cases: switching while streaming, background permission/completion, modal focus, draft retention, disclosure/scroll preservation, saved identity, Close/Restart and independent owned shutdown. Run authorized `mise run check` and offline browser validation where applicable before claiming regression evidence; fixture results are distinct from native acceptance. Prefer limited temporary duplication to a speculative shared abstraction that changes Pi semantics.

## Acceptance work before shipping

Use fixture agents for negotiation, unsupported capabilities, bidirectional requests, permission cancellation, malformed/disconnected streams, ordered replay/live updates, busy sends, cancellation completion, late old-generation events and owned-child shutdown. Cover session identity isolation, history failures without new-session fallback, and draft/selection preservation. No automatic retry after uncertain delivery.

Validate actual Copilot compatibility separately from fixtures, then a second agent separately. Record tested agent/protocol versions, platforms and capability gaps in the [verification reference](verification.md). No live paid requests, user-session mutation, tests, builds or app launches without the authorization required by repository policy.

The POC's user-facing behavior is documented in [ACP sessions](../../../../docs/acp.md), linked from the guide index and README, and recorded under Unreleased. Keep current limitations explicit until actual validation/agent acceptance closes them.

## Upstream references

Recheck protocol and agent support during implementation; these links are design inputs, not pinned compatibility evidence.

- [ACP initialization and capability negotiation](https://agentclientprotocol.com/protocol/initialization)
- [ACP session setup and history replay](https://agentclientprotocol.com/protocol/session-setup)
- [ACP session configuration options](https://agentclientprotocol.com/protocol/session-config-options)
- [Copilot CLI ACP server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
- [Copilot SDK](https://github.com/github/copilot-sdk)
