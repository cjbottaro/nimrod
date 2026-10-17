# Consumer-oriented integration interfaces

**Status: architectural direction with an incremental implementation, not a universal harness SDK.** Pi and ACP remain concrete integrations. This reference owns how we identify, define and extract internal interfaces; [harness presentation](harness-presentation.md) owns the existing presentation contracts, and feature references own behavior. No new user-visible capability or harness parity is implied.

## Decision

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

### Implemented extraction and remaining debt

`src/pi/session-startup.ts` now owns Pi's pre-launch-result packet buffer, native launch identity checks, release of ordered packets after identity/draft binding, and initialization sequencing. The shell supplies native transport wiring and shell effects. ACP does not inherit this algorithm: its negotiated new/load and replay ordering stay concrete.

This is **not a completed launch-controller extraction**. `main.ts::launchPi` and `launchAcp` still construct controllers, manage attempt state and wire many callbacks. `SessionLifecycleHost.connect` still delegates to these routines. Next, extract each concrete connection owner separately, using the existing startup helper where appropriate; do not relocate `main.ts` wholesale behind a giant host interface. Identify the minimal shell effects first (identity binding, presentation publication, notices/attention and ownership lifetime), retain exact ordering, and move one responsibility at a time.

## Candidate inventory

Names below are working labels, not pre-approved exported interfaces. Extract only when the named consumer and implementation evidence justify it.

| Candidate / current boundary | Consumer and need | Exclusions / next decision |
| --- | --- | --- |
| Persistence / connectivity — implemented above | Layout/drafts and connection/teardown | Keep composition convenient; split further only for a real narrower consumer. |
| Concrete connection owner — next extraction | Composition root needs a session-bound launch/teardown owner | Separate Pi/ACP implementations, not common initialization or a universal session state machine. Inventory shell effects before moving functions. |
| Conversation presentation — already exists in `conversation-view-host.ts` | Shared mounted view consumes incremental transcript/status/control projections | Preserve lazy history, reference stability and synchronous publication. No wire-event translation into Pi events; do not invent a second presentation model. |
| Interaction policy — already exists in `pi/view-policy.ts` and `acp/view-policy.ts` | Composer needs intent validation, supported submission behavior and controls | Pi steer/queue and ACP busy rejection remain concrete. Reuse existing policies before proposing another interface. |
| Session action contributions — partial in `session-backend.ts` | Palette/shortcuts need available actions bound to an owning session | Evaluate moving execution alongside availability/metadata; late execution revalidates the same owner. No generic `execute(string, unknown)` escape hatch. |
| Tool capture — implemented, unvalidated | Pi/ACP event producers publish native tool activity through `ToolCaptureSink`; local card-design diagnostics consumes JSONL records | [Tool capture](tool-capture.md) owns the consumer, minimum port, source mappings, ordering/lifetime, storage and evidence. No normalized tool schema, wire-event translation or execution capability. |
| Session list/history — implemented, unvalidated | Sidebar/Switch/Resume share `SessionListEntry` with semantic `SessionStatus`; Resume consumes project-bound `SessionHistory` discovery with paging/cancellation and source-local failure | [Session history](session-history.md) owns the contract. No connection owner per catalog entry; selection opens a session through its existing lifecycle. Pi catalog and Copilot ACP discovery remain concrete; no generic resume/delete protocol. |
| Deletion coordinator — implemented, unvalidated | Delete controls/picker consume target-bound label/detail, explicit support/reason and live availability through one coordinator; registered sources publish scoped review/progress and authoritative cleanup targets | [Session deletion](session-deletion.md#consumer-interface-and-copilot-deletion) owns concrete mappings and lifetime. Shared pending/locks/stop, review ownership, error routing, tombstones and target-based cleanup need no harness branches. Pi tree transactions remain native; Copilot requires advertised ACP deletion plus exact-project validation. Installed 1.0.98 lacks deletion. Never infer Delete from saved identity or Restart. |
| Configuration contribution — existing presentation, concrete execution | Status area/palette need advertised controls and current availability | Preserve real option IDs/values and independent busy/configuring gates. No universal model/thinking enum or permission approximation. |

Restart, attachments, notifications and permission UI may expose further seams, but do not add empty interface families in anticipation of future harnesses. Connection, saved membership, history discovery, restart and deletion are independent capabilities.

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

`test/session-lifecycle.test.ts` covers shared persistence/connectivity, concrete identities, token-scoped stop/retry, and ACP ownership without Pi fields. `test/pi-session-startup.test.ts` adds packet-order/bind-before-replay, live-generation filtering, identity rejection and initialization-failure fixtures. **These additions have not been run.** Existing shell/Pi/ACP fixtures remain the regression base; no native/platform acceptance is claimed.

The lifecycle extraction changed internal organization only. The subsequent [session-history implementation](session-history.md) adds Copilot Resume behavior and updates its user guides/changelog; its new fixtures have not been run. Validation still requires explicit authorization; use `mise run check`, and include offline browser tests when changing scrolling behavior.
