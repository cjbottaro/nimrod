# Consumer-oriented integration interfaces

**Status: required application registration/consumer ports source-implemented; behavioral and native acceptance remain pending; compile evidence is recorded in verification. Not a universal harness wire SDK.** Pi, Copilot SDK and ACP remain concrete integrations. This reference owns how we identify, define and extract internal interfaces; [harness presentation](harness-presentation.md) owns the existing presentation contracts, and feature references own behavior. No new user-visible capability or harness parity is implied.

## Decision

The [Copilot SDK](copilot-sdk.md) implements the existing persistence,
connectivity, history, deletion, interaction-policy and presentation ports
through concrete `src/copilot/` adapters. Its semantic events, identity namespace
and SDK-owned CLI lifecycle stay separate from ACP. Concrete connection ownership now lives under each integration's `integration.ts`; the shell composes registered ports and never calls a concrete launch callback. No universal protocol or launch state machine was introduced.
Current SDK fixture results and remaining baseline failures are tracked in [verification](verification.md#registered-harness-application-contract); older Pi/ACP pass results do not establish SDK acceptance.

**Shared interfaces describe what a Nimrod consumer needs; concrete implementations retain what each harness means.** Avoid both backend switches scattered through shared UI and a single all-purpose `Harness` controller. A small curated integration portfolio can share shell mechanics without sharing protocol, history or configuration semantics.

An interface is useful when it removes a consumer's need to interpret another layer's state. It is not useful merely because it renames a backend switch or forwards a long list of shell callbacks. Prefer structural TypeScript interfaces and functions; classes, registries, dependency-injection frameworks and public plugin APIs are not required.

Construction, persistence decoding and explicit integration-specific features may legitimately use tagged unions or backend switches. Do not optimize for eliminating every `backend.kind` check. Optimize for removing integration knowledge from consumers such as the Session sidebar, connection coordinator and shared conversation view.

## Responsibility rules

- **Project shell:** navigation, membership, mounted views, notices, focus, local bookkeeping and coordination of native effects. It composes concrete integrations and binds operations to their owning session.
- **Concrete integration:** protocol ordering, identity validation, history replay, semantic readiness, prompt/cancel behavior, configuration and permissions. Pi file identities and ACP saved IDs are not interchangeable.
- **Consumer interface:** only the projections/operations that its named consumer actually uses. An interface must not require importing the whole shell `Tab`, DOM, a concrete controller or another integration's owner state.
- **Native host:** window/token process ownership, framing and validated filesystem/native operations. Shared interface extraction must not broaden IPC privileges or change shutdown guarantees.
- **Presentation plugins:** content rendering, not lifecycle or integration authority. The public [card boundary](card-plugins.md#multi-harness-plugin-boundary) remains separate.

Share aligned mechanics, not approximate semantics. An unsupported operation is absent/unavailable, not a successful no-op, invented queue, fabricated metric or emulated deletion. Guarded connection attempts are an existing documented exception: their void completion is not a success acknowledgement.

## Current lifecycle example

`src/session-lifecycle.ts` now separates:

| Contract | Consumers | Meaning |
| --- | --- | --- |
| `SessionPersistence` | Project layout/draft coordination | Saved reference, project-local stable key and draft scope; read-only and independent of connection or Restart support. |
| `SessionConnectivity` | Selected-session connection coordinator and shell teardown | Display label, connection projection, startup policy, selection eligibility, connect, owned stop and local disconnect. |
| `SessionLifecycle` | Composition root | Convenience intersection of those two ports, not a destination for every session feature. |
| `SessionDeletionOperation` / `SessionDeletionSource` | Sidebar/Project bar controls, selected-session action and Delete sessions picker | Target-bound review/removal/reconciliation, with Pi tree and capability-gated Copilot single-session implementations; separate from lifecycle and history discovery. |

These projections read current owner state; they are not captured once at construction. Content streaming must not introduce per-chunk bookkeeping writes. Keep the existing conditional layout save/draft writer paths and stable saved encodings.

Shared `SessionLifecycleOwner` contains only token/starting/ended bookkeeping. `PiSessionLifecycleOwner` and `src/pi/session-file.ts` own Pi mode/file inputs; ACP receives its concrete profile/saved-ID state. Helpers accept the fields they actually need, and concrete adapters project controller availability to a boolean instead of imposing a common controller-state shape.

Ordinary `connect` options carry only accepted-action context. Pi-only initial naming and draft-copy creation arguments stay on the concrete Pi creation path in `main.ts`, not on an interface where ACP would silently ignore them. New-session creation and connecting an existing selection are distinct consumers even when they reuse a concrete launch routine.

### Lifecycle guarantees

- `identity`, `key` and `draftScope` are unavailable until the integration has a durable identity; disconnection does not erase them. Keys are scoped to the project. Saved Pi and tagged Copilot records keep their existing encoding; no history migration.
- `connection` is a projection: starting takes precedence, then a non-ended available controller is connected. It is not inferred from sidebar membership or native token presence.
- `eligibility()` is selection/reconnection policy, not general permission to create a session. The shell adds window/membership/selection gates; implementations retain their concrete availability/deletion gates.
- `connect()` settles when a guarded attempt has finished. Existing launch paths may skip work or report failure locally; resolution does **not** mean readiness. Observe connection state. Pi finishes its initialization sequence; ACP finishes negotiation and new/load initialization. Do not reinterpret these as equivalent wire acknowledgements. No submission/replay of prompts, repeat navigation or newer-draft mutation is authorized by completion.
- Concurrent selected-session attempts are coalesced by `SessionConnection`; concrete launch paths synchronously set `starting`. The interface itself is not a new scheduler, retry loop or cancellation framework.
- `stop()` awaits observation of the owned child's exit through the native host. Calls share work per token, including completed stops. Failure retains ownership and permits a later explicit retry. A new token has independent work; no token is a no-op. This is process teardown, **not** the composer Stop/cancel-turn operation.
- `disconnect(reason)` synchronously retires local protocol/pending operations. It does not itself await native exit; existing concrete disconnect observers may request `stop()`. It preserves saved identity and drafts. A replacement launch must still await owned stop.

### Integration completion bar

A required port is an application dependency, not an optional alternate route.
Shared consumers must actually use it. A new integration should implement the
required ports and register its factory/capabilities; changes to shared composer,
draft-store, sidebar or connection algorithms are boundary failures, not routine
integration work. Explicit composition, persisted-reference decoding, runtime
packaging and narrow native transport registration may remain integration-aware.
Unsupported optional capabilities are absent rather than simulated.

Finish each consumer boundary end-to-end, including downstream native consumers,
before calling it extracted. Consumer-path fixtures must exercise the actual
shared stores/coordinators; adapter conformance and mocked identity callbacks
alone do not establish integration. Static dependency fixtures prevent completed
boundaries from importing concrete authority again. These are internal
application ports, not a common wire protocol or a requirement to normalize
Pi/Copilot/Codex semantics.

### Implemented extraction and registration boundary

`src/pi/session-startup.ts` now owns Pi's pre-launch-result packet buffer, native launch identity checks, release of ordered packets after identity/draft binding, and initialization sequencing. The concrete Pi integration supplies native transport wiring and scoped shell effects. ACP does not inherit this algorithm: its negotiated new/load and replay ordering stay concrete.

Codex now has a concrete connection owner in `src/codex/connection.ts`.
The shell composes it; `SessionLifecycle.connect/stop/disconnect` route to its
attempt guards, native-project confirmation, ordered protocol startup,
synchronous draft binding before identity publication, retirement and cleanup.
Its host supplies window gates, identity-conflict lookup, a project-bound
transport, the draft consumer and explicit presentation/persistence/notice
effects—not a callback into a shell launch routine. Cleanup captures the
attempt's token; retired completion cannot stop or clear a replacement.
`ownedProcessStop` retains completed work per token for the owner's lifetime
and removes failed work only to permit an explicit retry.

The shared draft library now lives in `src/session-drafts.ts`.
[Draft scopes](native-drafts.md#draft-scope-contract) no longer enumerate
harnesses in either frontend binding/deletion or native staging. A fixture
integration unknown to the shared consumers exercises connection selection,
promotion, the actual dirty-record writer, restore and deletion without adding
a namespace to the application.

The application migration is now source-implemented for Pi, Copilot SDK and
Codex. The retained configured ACP factory implements the same ports without
adding product creation/options UI. `src/session-backend.ts` and all shell
`launchPi/launchCopilot/launchAcp` callbacks are removed. Concrete connection,
identity, protocol ordering, title/activity projection, permission/question UI,
history and deletion effects live in their integration modules. Pi retains its
ordered startup helper and native file/tree semantics; SDK and app-server
handshakes remain separate. Explicit Resume always crosses saved preparation/recovery before an existing row is activated; ordinary selection never implicitly recovers quarantined history. View `ready` is a local mount handshake consumed by the shell, not a required harness operation or a failed connection attempt.

`HarnessRegistration` (`src/harness-contract.ts`) is the required entry point.
`defineHarness` contextually checks the registration/project/session factory
returns; `HarnessRegistry` is the application's actual creation and saved-reference
routing path. A class may implement these interfaces, or a factory may return
structural implementations. No abstract base class, transport inheritance or
native-event translation is required.

| Required session port | Shared consumer |
| --- | --- |
| `lifecycle` | Selection connection coordinator, saved layout and teardown |
| `conversation` | Mounted transcript/composer, typed message input and view intents |
| `presentation` | Sidebar activity, badge, pending work and destructive-operation review |
| `configuration` / `actions` | Shared picker, operation cards, command palette and shortcut dispatcher |
| `restart` / `close` | Supported-operation controls and confirmation policy |
| `drafts` | Persistent versus memory-only draft/attachment lifetime |
| `selection` | Explicit versus restored-selection connection policy |
| `interactions` | Session activation/suspension and disposal of retained decisions |
| `references` | Optional native file-backed reference-window compatibility |

Every slot is mandatory, including unsupported feature slots.
`src/harness-defaults.ts` supplies explicit absent configuration/history/deletion,
unsupported saved history/restart, no project actions, no retained interactions/references, safe
selection/close policies and a generic idle text interaction. Core connect,
submission, protocol response and owned-stop implementations are not replaced
with successful no-ops. `displayUnsupportedInteraction` displays literal
question/request details and returns an explicit unsupported outcome; it does
not answer, approve or settle a native request. The concrete adapter retains
pending/error/cancellation semantics. Existing richer Codex/Copilot UI is retained.

Project ports include required `actions.current()` with executable, availability-checked `HarnessProjectAction` contributions (or explicit `noProjectActions`). Static action metadata only registers discoverability/shortcuts; it never substitutes for a live runner. Project actions have a shared palette/shortcut execution path independent of selected-session membership and revalidate availability at invocation.

Project ports own runtime initialization, saved-reference acceptance/keying and
preparation, history association/discovery, deletion-source registration and
session creation. The only product list is `src/bundled-harnesses.ts`.
Add a registration there plus its concrete implementation/native packaging
where needed; do not edit shared algorithms. New keyed runtime values and
integration-owned state are not new shell protocol fields. Existing persisted
Pi paths and tagged Copilot/Codex identities keep their encodings; a structurally
valid unregistered identity is never resumed or aliased to another integration.

Actions must carry an executable runner or a concrete configuration setting.
The shared consumer never guesses a setting from an action ID. Static creation/
action metadata also registers in Settings/reference windows; live session
contributions pass through the same bindable registry. New action IDs use
`harness-` namespacing and empty default shortcuts. Native application actions
retain their closed allowlist. Duplicate registrations/creation actions,
unsupported creation modes/naming, conflicting saved owners and inconsistent
identity/key/draft-scope projections fail explicitly.

Cards are another registration contribution (`genericCards` is the default).
Shared catalog/tool-card code dispatches by registered source, not a harness
switch. Unknown sources get literal/raw recovery (including native details), never a Pi-specialized card. The mounted view supplies its owning registration as the default source when a generic item omits one, retaining explicit native sources and immutable tool inputs. The same projection applies at initial mount and both retained standalone/embedded tool update paths, including dirty updates and hidden-session catch-up.
Standalone presentation fixtures install `src/bundled-card-renderers.ts`;
the legacy Pi view entry installs only its own renderer. Card plugins remain
presentation-only and source targets are structurally validated identifiers.

### Enforcement and acceptance

Normal `npm run typecheck` runs `scripts/check-harness-boundaries.mjs` before
TypeScript. The gate discovers implementation directories from their
`integration.ts` entry points and rejects shared imports/re-exports of concrete
authority (including type imports), shell native launch/write/stop calls and
backend discrimination. Inherited Pi presentation helpers, styles and explicit
bundled composition are the documented exceptions; Pi protocol/lifecycle entry
points remain private. Adding another implementation directory automatically
extends the guard.

`test/harness-contract.types.ts` is included by tsconfig and contains positive
factory conformance plus negative `@ts-expect-error` assertions for missing
mandatory ports, metadata-only actions and incorrect submission signatures.
Making those slots optional causes the negative assertions to fail compilation.

`test/fixtures/fixture-harness.ts` is a provider-free integration unknown to
production consumers. Registry fixtures exercise real input/draft/history/
action/deletion consumers and prototype-based implementations. The mounted
shell fixture changes only the composition import to register that fixture,
then creates, sends, displays a fallback question, closes, resumes and deletes
through unchanged application logic. Source/dependency, draft-scope and concrete
connection fixtures remain in place. Core registration and review-regression fixtures have executed, while whole-suite and native acceptance remain incomplete; [verification](verification.md#registered-harness-application-contract)
owns current execution status. Compilation proves structural completeness and
dependency discipline, not wire compatibility or native behavior.

## Shared ordered RPC mechanics

ACP's connection mechanics now live in `src/json-rpc-connection.ts`, consumed by
the existing ACP compatibility wrapper and the Codex app-server client.
This is a transport-mechanics extraction, not a new session/controller interface:
the consumer needs correlation, synchronous ordered response application,
bidirectional callback lifetime and disconnection, while concrete integrations
retain handshake, identity, history, permission and turn semantics.

ACP requires the JSON-RPC version member; Codex omits it. Both retain
single-use connections, request-local protocol errors versus uncertain delivery,
and aborted late-reply suppression. Codex's server-resolved callbacks additionally
use targeted incoming-request cancellation. Framing/byte limits, native ownership
and process teardown remain outside this connection. Pi does not use it.

The small `CodexWriter` interface supplies only ordered decoded-record writes.
`CodexClientHooks` carries concrete identity/event/approval effects, not a
universal harness host. The integration adds the narrower project-bound
`CodexTransport` for native conversation/catalog consumers and implements existing
lifecycle/history/input/configuration ports. Codex connection ownership is extracted
as described above; other integrations now own their connection paths as well. Tagged persistence is integration-owned. Existing ACP fixtures remain the regression base;
`test/json-rpc-connection.test.ts` and `test/codex-client.test.ts` cover these mechanics; [current validation](verification.md#registered-harness-application-contract) owns executed evidence. See the [Codex integration skill](../../codex-integration/SKILL.md)
for current mappings/scope and [verification](verification.md#codex-integration) for evidence.

## Retained question presentation

`src/question-interaction.ts` owns the actual presentation/FIFO/input responsibility extracted from Copilot for two concrete consumers: Copilot SDK questions and Codex experimental question batches. `QuestionPrompt` supplies only text/header, literal choice labels/details, freeform availability and an optional answer-size bound. `QuestionUi` supplies the shared retained palette and child input, guarded eligibility, counts/banner and error effects. `QuestionAnswer` returns the literal answer plus whether the user entered text. `QuestionPrompt.allowIgnore` optionally adds a local no-answer settlement action; only Codex async questions opt in, not Copilot or Codex blocking batches. Dismissal does not settle a request; abort/disposal does, without inventing a protocol reply. Concrete adapters retain native IDs, schema validation, batching and permission/mode meaning. This is not a session controller or universal interaction protocol; existing lifecycle/configuration interfaces are unchanged. Current execution status for Codex and Copilot fixtures is recorded in [registered-harness validation](verification.md#registered-harness-application-contract); [Codex questions](../../codex-integration/references/questions.md) and [verification](verification.md#codex-questions) own mappings/evidence.

## Candidate inventory

Names below are working labels, not pre-approved exported interfaces. Extract only when the named consumer and implementation evidence justify it.

| Candidate / current boundary | Consumer and need | Exclusions / next decision |
| --- | --- | --- |
| Persistence / connectivity — implemented above | Layout/drafts and connection/teardown | Keep composition convenient; split further only for a real narrower consumer. |
| Concrete connection owners — source-implemented | Registry composition needs session-bound launch/teardown owners | Separate Pi/SDK/Codex/retained-ACP implementations own attempts, binding and captured-token cleanup. No common initialization or universal session state machine. |
| Conversation presentation — already exists in `conversation-view-host.ts` | Shared mounted view consumes incremental transcript/status/control projections | Preserve lazy history, reference stability and synchronous publication. No wire-event translation into Pi events; do not invent a second presentation model. |
| Message input — implemented, acceptance partial | Shared composer needs live image support/limits and typed submission without inspecting a backend or encoding SDK/RPC payloads | `SessionMessageInput` has live `capabilities()` and `submit(OutgoingMessage)`; all controllers implement it, while the shell binds session lifetime and unexpected errors. Shared `AttachmentHost` owns local bytes separately. Pi keeps steer/queue; Copilot maps SDK blobs and idle-only sends; ACP stays text-only. Promise settlement is not common delivery/turn completion. [Image input](image-paste.md#message-input-interface) owns full contract, mappings and evidence. |
| Interaction policy — already exists in `pi/view-policy.ts` and `acp/view-policy.ts` | Composer needs intent validation, supported submission behavior and controls | Pi steer/queue and ACP busy rejection remain concrete. Reuse existing policies before proposing another interface. |
| Session action contributions — registered executable/configuration ports | Palette/shortcuts/Status area need supported actions bound to an owning session, while application/project actions remain usable without one | Global definitions declare application/project/session context; concrete integrations contribute supported session IDs and metadata. Execution uses an integration-bound runner or its explicit setting target; the shell revalidates the same owner. No generic `execute(string, unknown)` escape hatch. |
| Transcript logging | Nimrod diagnostics consumes native records through `TranscriptLogSink` | [Transcript logging](transcript-logs.md) owns the contract and concrete producers; no normalized conversation protocol or execution capability. |
| Session list/history — implemented, unvalidated | Sidebar/Switch/Resume share `SessionListEntry` with semantic `SessionStatus`; Resume consumes project-bound `SessionHistory` discovery with paging/cancellation and source-local failure | [Session history](session-history.md) owns the contract. No connection owner per catalog entry; selection opens a session through its existing lifecycle. Pi catalog and Copilot SDK discovery remain concrete; no generic resume/delete protocol. |
| Deletion coordinator — implemented, unvalidated | Delete controls/picker consume target-bound label/detail, explicit support/reason and live availability through one coordinator; registered sources publish scoped review/progress and authoritative cleanup targets | [Session deletion](session-deletion.md#consumer-interface-and-copilot-deletion) owns concrete mappings and lifetime. Shared pending/locks/stop, review ownership, error routing, tombstones and target-based cleanup need no harness branches. Pi tree transactions remain native; Copilot uses supported SDK deletion plus exact-project validation. Codex implements the same port with a guarded spawned-tree inventory/API, not a second UI; its [concrete contract](../../codex-integration/references/deletion.md) owns limitations. Review nodes now use opaque key/parentKey fields, while Pi file fields remain behind its adapter. Custom ACP has no deletion UI. Never infer Delete from saved identity or Restart. |
| Independent configuration owners — implemented, unvalidated | Shared configuration/picker/operation-card consumers need multiple configuration domains | `ConfigurationOwner` plus `SessionConfigurationSet` compose existing ports, not a universal harness controller. Permission command shortcuts now remain integration-owned session actions outside this port. See [Permission command shortcut](live-permissions.md). |
| Session configuration — implemented, unvalidated | Model/effort picker consumes `SessionConfiguration` capabilities, confirmed getters, advertised choices and intent setters; Pi, SDK and dormant ACP retain concrete mutation/readiness semantics | [Model/thinking](model-thinking.md) owns latest-wins deferred intent, dependency validation, local transcript progress, disposal and evidence. Not a lifecycle/prompt controller or public plugin API. |
| Status-area presentation — implemented, unvalidated | Shared Status area consumes `StatusAreaSnapshot` with explicit surface capabilities, keyed supported controls and current availability; Pi and Copilot SDK project their own semantics | [Harness presentation](harness-presentation.md#status-area-interface) owns the contract/mappings, ordered publication and reference-stability guarantees. Configuration execution/palette ownership remain concrete. No duplicate model/thinking capability flags, universal enum or permission approximation. |

Restart, notifications and permission UI may expose further seams, but do not add empty interface families in anticipation of future harnesses. Connection, saved membership, history discovery, restart and deletion are independent capabilities.

## Definition checklist

Before implementing a candidate, record the following here or in its owning feature reference:

1. **Consumer/problem:** exact caller(s), current code anchors, and the integration knowledge being removed.
2. **Minimum contract:** required values/operations and why each is needed. State whether projections are live, immutable snapshots or event publications; define update ordering and invalidation.
3. **Concrete mappings:** Pi and ACP examples where applicable, semantic mismatches and unsupported cases. A single real consumer may justify a narrow port, but not speculative generalization for imagined harnesses.
4. **Authority/lifetime:** who owns identity, requests, state, native tokens, subscriptions and disposal. Bind async work to its originating session/generation.
5. **Async guarantees:** precise meaning of completion, error versus uncertainty, idempotency/coalescing, cancellation, stale results and cleanup. Never replay ambiguous prompts.
6. **Effects:** which immediate user effects belong to the shell/view and which authoritative results reconcile them. Preserve the [optimistic interaction policy](architecture.md#optimistic-interaction-policy).
7. **Migration:** files/call sites moved, compatibility wrappers or storage encodings retained, and explicit remaining shell responsibilities. Avoid mixed behavior changes during extraction.
8. **Evidence:** fixture assertions, current validation status and remaining native/platform gaps. Interface conformance alone does not establish behavioral substitutability.

Accept an extraction when the consumer no longer interprets backend-specific state, the contract preserves actual semantics, and responsibility moved to the correct owner. Reject interfaces that merely wrap a switch while leaving the same decisions in every caller, require unsupported methods, or turn every concrete difference into another flag.

## Evidence and documentation

`test/session-lifecycle.test.ts` covers shared persistence/connectivity, concrete identities, token-scoped stop/retry, and ACP ownership without Pi fields. `test/pi-session-startup.test.ts` adds packet-order/bind-before-replay, live-generation filtering, identity rejection and initialization-failure fixtures. These fixtures were executed during registered-harness validation. Existing shell/Pi/ACP fixtures remain the regression base; [verification](verification.md#registered-harness-application-contract) owns the executed results and remaining baseline failures. No native/platform acceptance is claimed.

The lifecycle extraction changed internal organization only. The subsequent [session-history implementation](session-history.md) adds Copilot Resume behavior and updates its user guides/changelog; its current execution status is recorded in verification. Validation still requires explicit authorization; use `mise run test`, and include offline browser tests when changing scrolling behavior.
