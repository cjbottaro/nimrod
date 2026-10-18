# Composer delivery and keyboard hints

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#composer) retain prior execution records.

## Harness boundary

`src/copilot/view-policy.ts` contributes SDK text-only intent validation and
model/thinking intent accepted while connected with idle-only application
([configuration progress](model-thinking.md) is separate from prompt queues). Busy Enter keeps the newer draft; Stop calls
SDK abort, with no Pi queue/steer. [Copilot commands](copilot-commands.md) use SDK
command invocation rather than ordinary prompts or Nimrod action aliases;
metadata drives argument suggestions and returned choices use a session-bound
modal. Commands clear immediately without literal previews, recency or forced
navigation. Ordinary local submission effects still clear/preview immediately; ambiguous results disconnect
without replay/restoring sent text. [SDK events](copilot-sdk.md#send-events-controls-and-decisions)
own echo reconciliation, cancellation and decisions. New fixtures are unrun.

The detailed delivery/queue/compaction contract below is Pi-specific. The [shared view boundary](harness-presentation.md) requires an integration-owned interaction policy; there is no `ViewHost.acp` switch. `src/pi/view-policy.ts` owns Pi slash interception, busy steering/queue mapping, skill interpretation and compaction hints. `src/acp/view-policy.ts` owns advertised-only completion, text-only sending and agent-labeled Stop; busy Enter keeps the newer draft. ACP configuration/turn lifecycle stays in `src/acp/session.ts`, not Pi's controller. `mountPiView` remains a compatibility entry supplying Pi policy/projection. Mixed-shell/browser and new/updated extraction fixtures pass in the full offline gates; native acceptance remains separate.

## Specification and acceptance criteria

Idle sends and busy Enter steering clear the editable draft immediately, independently of acknowledgement. Busy-only explicit follow-up queues and immediate idle/steering pending turns reconcile without duplicate user messages, result-driven transcript scrolling or inferred consumption. Local Send navigation follows the [auto-follow preference](transcript-interaction.md#auto-follow-after-sending). Apply the [optimistic interaction policy](architecture.md#optimistic-interaction-policy); Send also updates sidebar recency immediately.

## Code map

- `src/pi/composer-dom.ts`: keyboard delivery mapping and hint ordering.
- `src/conversation-view.ts`: policy-driven keyboard submission, send-local image preparation, receipt-correlated operation-card outcomes, fallback notices and input lock. Pi compatibility entry: `src/pi/webview-client.ts`.
- `src/pi/session.ts`: authoritative session-state gate and Pi prompt RPC.
- `src/pi/steering-transcript.ts`: live pending-turn projection, queue reconciliation and user-turn key aliases.
- `src/conversation-view.ts`: applies every ordered snapshot before coalesced painting, including while hidden; hidden views retain the latest pending presentation for synchronous reveal catch-up. Queue/consumption/receipt/recovery observations are never deferred or discarded. Patches pending-status labels in the existing user article.

Image attachment behavior and its text-only queue recovery boundary are covered in [Image paste](image-paste.md). Error/uncertainty presentation follows the [error presentation policy](error-presentation.md); this reference owns delivery semantics, not a separate error surface.

## Contract

- Idle: Enter sends normally; Option-Enter also sends normally, never queues. Hints: `Enter to send · Shift+Enter for newline`.
- Main agent working: Enter steers; Option-Enter queues a follow-up. Hints: `Enter to steer · Option-Enter to queue · Shift+Enter for newline`.
- Option is the macOS name for the Alt modifier (`KeyboardEvent.altKey`); Linux uses Alt+Enter. The current hint text uses the macOS label.
- Shift+Enter and IME input are not consumed by submission mapping.
- The controller sends `streamingBehavior: followUp` only for explicit `followUp` delivery while its main agent is busy. All other prompts include `steer`, preserving idle-to-busy race handling. If the controller is already idle after a busy renderer snapshot, the submission uses the ordinary steering fallback.
- Bare `/mcp` clears the command and opens the shared palette inspector before ordinary submission effects; no pending turn, local Send/recency notification or transcript auto-follow. Explicit `/mcp` subcommands retain Pi delivery. [MCP inspector](mcp-inspector.md) owns its session query and compatibility boundary.
- Compaction locks submission and replaces keyboard hints with its cancellation hint. Background-only activity does not enable queueing.
- Send captures text and starts all image reads locally, then `clearDraft` consumes editable text/attachments synchronously. `ViewHost.promptSubmitted` synchronously notifies the shell of local message intent (ordinary, steering, follow-up and prompt slash expansions, excluding `/name` and `/compact`); it carries no payload/receipt, retains no submission state and fires before image preparation completes. The shell advances recency once and scrolls the current All/Working list to the top; Unread retains arrival order and reading position. Another prompt may be sent before its RPC result; only image preparation briefly serializes payload dispatch. Receipts update steering labels or report failures, never modify the current draft, including identical retyping/re-pasting. Failure/uncertainty belongs to the existing operation card when a preview exists; without a card it reports through session notices; no recovery copy, Write a new message action or uncertainty-specific gate. Availability/compaction/deletion guards remain. Local validation before clearDraft keeps the editable draft.

## Pending user turns in the transcript

Shared title/layout/outcome/cancellation rules live in [Operation cards](operation-cards.md). Pi retains the delivery semantics below; no universal acknowledgement protocol is introduced.

- Idle/busy plain-text sends preview before posting; image previews appear after local byte preparation, also before posting. Ordinary idle previews have no pending operation title and remain non-sticky, including idle-to-busy queue adoption. Explicit steering and follow-up previews use stable **STEERING** / **QUEUED** titles and both join the shared bottom-pinned stack while pending.
- RPC acknowledgement and queue removal never stop shimmer or unpin. Only a matching authoritative user event settles delivery, adopts the preview's key at Pi's position and stops shimmer. Retain the same title span, now static with unchanged uppercase/spacing. This runtime title is not written to Pi history or reconstructed on Resume. No separate success receipt is added.
- Existing history is marked seen before submissions. Text matching trims outer whitespace, joins text blocks and consumes equal occurrences FIFO per delivery kind; steering takes precedence over identical follow-ups. Image prompts with ordered started-preflight correlation adopt by submission ID, preserving authoritative normalized content rather than matching caption/bytes; [Image paste](image-paste.md#invariants) owns that boundary.
- Observe every ordered snapshot, including while hidden and across coalesced paints. Queue removal alone is not proof of consumption. Do not infer consumption from counts, idle, external queue clearing or receipt timing.
- Rejection retains a Failed operation card with red accent and full Error details when supplied. Uncertain acceptance/unconfirmed delivery retains Outcome unknown with grey accent and optional Details. Ordinary failed/unknown idle previews use a **MESSAGE** title; ordinary success still has no operation header. Capture terminal local placement before later output, using only the latest observed tail key, not retained historical content.
- Confirmed user cancellation removes the local preview. Rejected previews cannot consume later equal user events; already-authoritative Pi turns remain untouched. Uncertainty can reconcile if a later actual user event establishes delivery. Late receipts never clear/restore the composer or rewind an adopted authoritative turn.
- No per-card Cancel is offered for Pi steering/queued messages: supported clear_queue is whole-queue recovery, not individual withdrawal. Never clear/replay the rest of a queue to emulate targeted cancellation. Stop retains its concrete Pi behaviour.
- Authoritative pending counts remain in the Status area; message text stays in the transcript. The shared stack has bounded independent overflow and opaque masking, ordinary user-turn spacing/padding, no separator or extra compact styling. Errors/disconnection unpin without forced navigation.
- Clear_queue recovery removes matching previews by occurrence/delivery kind, including image-bearing follow-ups against text-only recovery; steering retains its image-recovery exclusion. Returned nonempty text remains in existing Restore controls. Image-only empty strings create no blank Restore rows.
- Projectors, aliases, operation titles and receipt correlation are runtime-only. Explicit sessionReset replaces them; draft persistence retains only editable draft/queue recovery. No replay, fictitious history reconstruction or persisted submission lifecycle.
- Rendering uses existing queueRender and TranscriptScroll ownership. Same-key updates preserve nodes/disclosures/title animation; no per-frame JS, layout-growing shimmer or draft-keystroke transcript renders. Hidden/inactive animations pause; reduced motion stays readable. Local Send's explicit auto-follow preference remains independent of all outcome handling.

## Typing hot path

Draft-only edits retain status/control DOM and update the in-memory draft immediately. Native CSS content sizing is used where supported, otherwise one coalesced pre-paint measurement uses the latest text. Hide/dispose cancels pending sizing; selection sizes the latest draft. The fallback retains the shell-height hold/floor measurement so it cannot clamp transcript reading during measurement. Send/Stop retains its SVG unless the action changes.

Draft persistence, debounce, immediate clearing, ignored legacy drafts, image references and the performance fixture are documented in [Native drafts](native-drafts.md). The original baseline performed 160 input-handler geometry reads and 800 status/button mutations for 80 characters; the current supported-WebKit fixture performs neither, and no localStorage writes. Timings remain diagnostic, not native input-to-paint acceptance.

User guide: [Drafts](../../../../docs/drafts.md).

## Verification

`test/composer-dom.test.ts` covers idle/busy mapping, exact hint order, newline and IME guards. `test/session.test.ts` covers prompt RPC delivery and acknowledgement, including explicit follow-up requests arriving while idle. DOM/unit coverage is not native keyboard acceptance on macOS or Linux.

`test/steering-transcript.test.ts` covers FIFO duplicates, historical exclusions, event-before-receipt, both authoritative queues/dequeue/recovery, steering precedence over identical follow-ups, image-bearing recovery and disconnect labels. `test/native-view.test.ts` covers immediate safe-Markdown previews, in-place reconciliation, acknowledgement/newer drafts, coalesced clear/recovery, failures/reset, retained rejected turns excluded from reconciliation, uncertainty without recovery gates, steering-label persistence through acknowledgement/dequeue, authoritative queue projection, event/image lifecycle, follow-up sticky-to-normal identity, error/disconnect unpinning, queue recovery/reset and slash exclusions. `test/send-outcomes.test.ts` covers draft-only clearing/reload and retired-submission/backup removal. Renderer/session fixtures cover multiple sends before acknowledgement, out-of-order outcomes, unchanged identical next drafts and images captured before temporary storage release. Local Send effects cover normal/steering/follow-up/image intents before results or image preparation, exclude controls/locally blocked sends, and never repeat on a late result. Preparation cannot dispatch across Stop, reset or disconnect. `test/browser/steering-transcript.spec.ts` uses only the offline demo in automated WebKit to verify idle previews before gated native dispatch, stable idle/steering user articles, Steering before dispatch and through acknowledgement, with no intermediate delivery labels and preserved drafts/focus. Idle submission navigation follows the configured mode; busy submission preserves reading by default. Renderer fixtures cover idle event-before-receipt and receipt-before-event, historical duplicate exclusions, FIFO identity, idle-to-busy queue adoption, rejection/uncertainty/disconnect and idle image reconciliation. `test/browser/queued-transcript.spec.ts` verifies bottom anchoring in short transcripts, bounded long queues, and stacked follow-ups remaining visible at the pane bottom during streaming and older-history reading, reconcile in place without forced scroll/focus, and preserve newer drafts. `test/browser/delivery-status.spec.ts` covers exact ellipsis-free labels, historical tool-header typography (system UI font/size/weight, uppercase and .05em spacing) for steering/queued labels with and without animation, shimmer direction, stable text geometry, reduced-motion readability, pause/resume with hidden session identity, and immediately acknowledged steering still shimmering until its authoritative user event; queued fixtures compare ordinary/queued article styling and absence of a separator. The offline demo distinguishes steering and follow-up queues and consumes steering first. The user observed the prior native steering label disappearing at fast RPC acknowledgement while Queued remained visible; the corrected user-event lifetime is fixture-verified. Native perceived-latency/sticky-layout/shimmer appearance acceptance for the correction remains a user check.

User-facing behavior: [architecture](../../../../docs/writing-messages.md#steering-messages).
