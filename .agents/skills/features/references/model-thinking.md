# Model and thinking preferences

**Status: shared configuration port and deferred changes source-implemented; new/updated fixtures unrun.** This reference owns configuration interface/intent semantics and local transcript progress. [Harness presentation](harness-presentation.md#status-area-interface) separately owns the Status-area snapshot; [verification](verification.md) separates offline evidence from native acceptance.

Human guide: [Model and thinking preferences](../../../../docs/model-thinking.md).

## Consumer interface

`src/session-configuration.ts::SessionConfiguration` is a small session-bound consumer port, not a universal session/controller or wire protocol. `main.ts` and `configuration-picker.ts` no longer dispatch model/effort selection by backend:

- `capabilities`: supported setting descriptors with opaque IDs, labels, optional dependencies and live `ready` / `deferred` / `unavailable` availability/reasons. The common picker uses `model` and `effort`; concrete ACP options can contribute additional IDs. No common provider/model/effort enum.
- `get(id)`: current harness-confirmed value, including undefined when unknown. Successfully accepted Copilot creation inputs provide initial values until concrete SDK values arrive; they are not reused on Resume or later deselection. It never returns pending intent as effective state.
- `choices(id)`: fresh advertised choices bound to this configuration object, setting and dependency values. Each choice has an opaque value, primary label and optional secondary detail/search terms for the shared picker; concrete integrations own that presentation metadata. `set(id, choice)` accepts one of those choices synchronously; it is acceptance of local intent, not an RPC acknowledgement or a success promise.
- `operations`: immutable-by-convention, reference-stable local progress publications. Owners publish them as `configurationOperations` on the existing synchronous conversation snapshot channel. No additional subscription/event bus, persistence or process ownership.

`SessionConfigurationController` owns only latest-wins intents, dependency ordering, validation and operation publication. `ConfigurationAdapter` retains concrete metadata/readiness, mutation and authoritative reconciliation. `ConfigurationDeferred` is exclusively a **pre-dispatch** readiness-race result: it must never be thrown after a mutation might have been delivered. Adapters also receive a current-intent predicate and recheck it immediately before dispatch; `ConfigurationSuperseded` retires obsolete metadata preparation without sending its mutation. Ready unrelated settings can proceed without waiting behind a deferred independent setting; prerequisites still run first.

The composition helper `sessionConfiguration` accesses the selected concrete owner's port. Session identity, transport, initialization, lifecycle, permissions and prompt/cancel semantics remain bespoke. Status projections read the same confirmed concrete configuration, behind their separate presentation interface.

## Availability and pending intent

- Ready: accept the selection and apply after fresh validation.
- Deferred: accept the selection immediately, show local progress, and apply when the concrete owner publishes a supported readiness transition. No polling timer, agent stop, reconnect, new prompt or request replay.
- Unavailable/unsupported: reject before accepting intent. Startup/disconnection do not become a durable queue or trigger automatic Resume.
- A second selection replaces the still-pending value and updates the same operation key/article/title span. A dispatched mutation cannot be undone; newer choices wait behind it and apply serially after it reconciles. An error/uncertain result clears remaining intents, never automatically retries the mutation.
- Model is a prerequisite of effort. Effort choices are bound to the effective or pending target model, and are rechecked after asynchronous metadata reads and immediately before dispatch. Replacing a model intent drops an effort queued for the previous target. A picker opened for another target is rejected. No effort clamping or guessing in shared code.
- Disconnection, Close, Restart, deletion or owner replacement disposes this exact configuration object. Pending progress becomes cancelled; late completion cannot revive it or apply work to another connection. Switching the selected session alone does not cancel already accepted intent; it stays with its owning session.
- Setters/getters never navigate, focus, clear/restore drafts, touch Send recency, send a prompt or create usage. Existing authoritative configuration results remain the narrow display-confirmation requirement; they are not a general UI gate.

## Local configuration transcript entries

These are Nimrod-owned **configuration changes**, not user/assistant messages, synthetic harness output, tool executions or persisted conversation records. `ConfigurationTranscript` projects them beside the existing steering/queued presentation without modifying canonical harness message arrays.

- Waiting: shimmering `Model change queued` / setting-specific title and literal requested value text.
- Applying: shimmering `Changing model` / setting-specific or combined configuration title.
- Completed, failed or cancelled: stop shimmering, retain a terminal marker locally for this connection. Operational error details still go through the originating session notice, not duplicate error turns.
- Pending entries use the same bottom-sticky, bounded stack, user-like layout and CSS-only text-width shimmer as Queued/Steering. They preserve their keyed article/title span across replacement and application. Completed entries unpin in place and anchor after the then-current transcript tail, retaining position as later conversation arrives. If compaction removes the anchor, retain the local marker at the tail rather than injecting it into harness history.
- No pending indicator, speculative value or pending tooltip is added to the Status area. It shows only confirmed selections and changes when the concrete integration reconciles authoritative state. Connected controls remain usable during deferred/in-flight changes so another choice can replace pending intent.
- Every presentation update uses existing `queueRender`, hidden-session catch-up and `TranscriptScroll` capture/request ownership. No Send-style auto-follow, forced bottom navigation, focus change or new scroll owner. Same-key updates add exact dirty rows without reading lazy history; structural insertion/unpin/removal uses full fallback. Reduced motion and hidden/inactive animation pause reuse existing delivery-label CSS.
- Entries/intent are runtime-only. No draft/queue restoration, reload reconstruction, Pi journal writes, SDK history entries or user-prompt payloads. Explicit session reset removes local entries.

## Concrete mappings

### Pi

`src/pi/session-configuration.ts` wraps `ModelThinkingController`'s direct metadata/mutation API. Model values encode the full provider/id pair; fresh available-model reads are filtered through Pi's configured scope before offering **and** applying. Missing scope never exposes all models.

Pi model choices use the reported friendly name (falling back to model ID) as the picker label and provider as secondary detail. A distinct model ID remains searchable when a friendly name is present. Stable opaque values, not rendered labels or list positions, identify selections.

Main-agent work and compaction do not block configuration. Installed Pi 1.1.0 accepts `set_model` / `set_thinking_level` for upcoming requests; in-flight requests keep their prepared configuration, while a continuation after tools can use the new selection. Preserve main/compaction activity through refresh.

Readiness/disconnection, pending prompt/name acceptance and the concrete changing lock still guard mutation. Those transient locks defer new intent instead of disabling the picker. Requests use fresh state/levels and acknowledged refresh; Pi owns auth, model-switch defaults, persistence and effort clamping. A failed mutation resyncs without retrying. Legacy controller picker methods remain for compatibility/fixtures; live session/palette paths use the shared port and direct mutation API.

Pi exposes levels only for its currently selected model. If another model is pending, wait for it to apply before opening its effort picker rather than inventing target-model capabilities.

### Copilot SDK

`src/copilot/session-configuration.ts` uses the filtered catalog/current root model and supported reasoning efforts. Pending target models can supply their own advertised effort choices. `CopilotSession` owns idle-only SDK configuration, including command/configuration-in-flight guards; the picker can accept intent while those guards defer mutation. Pending work begins after the actual root idle boundary, not a child event or an acceptance response.

Copilot model choices use the catalog's friendly name as the picker label and model ID as secondary detail. Stable model IDs, not rendered labels or list positions, identify selections.

New sessions honor non-null Copilot model/effort preferences read through the SDK; each null value is omitted independently from creation options. Unknown display values are lowercase `default model` / `default effort`, and actual session values supersede creation inputs. Resume never inherits newly configured defaults. `copilot/configuration.mjs` owns that concrete bridge-side policy; live getters/pickers remain behind `SessionConfiguration`, and presentation remains behind `StatusAreaSnapshot`. Native `session.model_change`/deselection outrank older results. Mutation failure/uncertainty disconnects rather than continuing with unconfirmed configuration. Shared code checks the reconciled getter before declaring success and never replays a failed request. [Copilot SDK](copilot-sdk.md) owns native transport/API scope.

### Dormant generic ACP

`AcpSession.configuration` maps advertised options, including model/thought-level/mode and opaque remaining option IDs. It queues while the agent/configuration is working and applies through the existing supported ACP method at real idle. Response/update receive order remains authoritative. Thought-level choices are not approximated for a pending different model; wait for its advertised options. This does not restore any ACP product entry points or Copilot ACP support.

## Code map

- `src/session-configuration.ts`: port, descriptors, capability/availability, choice provenance/dependencies, serialized latest-wins coordinator, disposal and local operations.
- `src/configuration-picker.ts`, `src/main.ts`: one session-bound choice path, palette lifecycle and originating-owner revalidation. Picker completion means intent accepted; it does not await a later idle turn.
- `src/pi/session-configuration.ts`, `src/pi/model-thinking-controller.ts`, `src/pi/session.ts`: concrete Pi port, fresh scoped metadata, guarded direct mutation and acknowledged refresh.
- `copilot/configuration.mjs`, `src/copilot/session-configuration.ts`, `src/copilot/session.ts`: concrete SDK defaults/snapshot reconciliation, live interface, target-model effort choices, readiness and authoritative native-event precedence.
- `src/acp/session.ts`: retained internal ACP port and native option execution.
- `src/configuration-transcript.ts`, `src/conversation-view.ts`: local-only keyed rows, structural/incremental projection, retained title/animation and existing paint/scroll boundaries.
- `src/status-area.ts`, `src/pi/status-area.ts`, `src/copilot/status-area.ts`: confirmed display only; no speculative pending state.
- [Command interactions](command-interactions.md) and [keybindings](keybindings.md): cancellation/focus/current markers and existing model `primary+shift+m` / effort `primary+shift+e` actions. No new action or shortcut.

## Authored verification and remaining gaps

The feature's tests/checks and native behavior remain **unrun/unverified**. A subsequent compile correction renamed Copilot's private snapshot reader to `applyConfigurationSnapshot`, avoiding its collision with the public `configuration` port (TS2300/TS2349). `mise exec -- npm run build` passes TypeScript and frontend production bundling for that correction; it does not establish configuration behavior or native acceptance. No app launch or live harness operation was performed.

- `test/session-configuration.test.ts`: latest-wins queued/in-flight requests, supersession during pre-dispatch validation, stable operation publications, dependency ordering, stale effort choices, revocation, failure/no-retry, dispose/late completion and local projection anchoring.
- `test/pi-session-configuration.test.ts`: provider identity, scope, changes during work/compaction, preflight deferral and revoked choices. Existing `model-thinking-controller.test.ts` remains the concrete readiness/mutation regression base.
- `test/copilot-sdk.test.ts`, `test/acp-session.test.ts`: real concrete controllers queue/replace/apply on idle, preserve confirmed status, handle model/effort dependency and cancel on disconnect. SDK native events still outrank old responses.
- `test/conversation-view.test.ts`: one retained queued-style article/title, unchanged confirmed controls, incremental replacements with forbidden lazy-history reads, hidden terminal catch-up and reset. `test/native-view.test.ts` and `test/status-area.test.ts` reflect request-capable controls during an in-flight change.
- `test/browser/copilot-sdk.spec.ts`: offline SDK busy changes, sticky/shimmer identity, latest-only mutation, reader offset/newer draft preservation and confirmed status reconciliation. Existing Queued/Steering/hidden-session fixtures remain regression targets.

When explicitly authorized, run `mise run test` and `npm run test:browser` because this changes transcript layout/scroll participation. Native macOS visual/focus/reader behavior, real Pi/Copilot configuration, Linux and possible Windows acceptance remain unverified. No paid prompt, live compaction or user-session operation is authorized by these fixtures.
