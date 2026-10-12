# Composer delivery and keyboard hints

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#composer) retain prior execution records.

## Specification and acceptance criteria

Idle sends and busy Enter steering clear the editable draft immediately, independently of acknowledgement. Busy-only explicit follow-up queues and immediate idle/steering pending turns reconcile without duplicate user messages, forced scrolling or inferred consumption.

## Code map

- `src/pi/composer-dom.ts`: keyboard delivery mapping and hint ordering.
- `src/pi/webview-client.ts`: busy-state hints, keyboard submission, send-local image preparation, receipt-only error reporting and compaction lock.
- `src/pi/session.ts`: authoritative session-state gate and Pi prompt RPC.
- `src/pi/steering-transcript.ts`: live pending-turn projection, queue reconciliation and user-turn key aliases.
- `src/pi/webview-client.ts`: applies every ordered snapshot before coalesced painting; patches pending-status labels in the existing user article.

Image attachment behavior and its text-only queue recovery boundary are covered in [Image paste](image-paste.md). Error/uncertainty presentation follows the [error presentation policy](error-presentation.md); this reference owns delivery semantics, not a separate error surface.

## Contract

- Idle: Enter sends normally; Option-Enter also sends normally, never queues. Hints: `Enter to send · Shift+Enter for newline`.
- Main agent working: Enter steers; Option-Enter queues a follow-up. Hints: `Enter to steer · Option-Enter to queue · Shift+Enter for newline`.
- Option is the macOS name for the Alt modifier (`KeyboardEvent.altKey`); Linux uses Alt+Enter. The current hint text uses the macOS label.
- Shift+Enter and IME input are not consumed by submission mapping.
- The controller sends `streamingBehavior: followUp` only for explicit `followUp` delivery while its main agent is busy. All other prompts include `steer`, preserving idle-to-busy race handling. If the controller is already idle after a busy renderer snapshot, the submission uses the ordinary steering fallback.
- Compaction locks submission and replaces keyboard hints with its cancellation hint. Background-only activity does not enable queueing.
- Send captures text and starts all image reads locally, then `clearDraft` consumes editable text/attachments synchronously. There is no composer submission state or shell submission callback. Another prompt may be sent before acknowledgement; only image preparation briefly serializes payload dispatch. Pi acknowledgement alone establishes acceptance. Receipts update steering labels or report failures, never modify the current draft, including identical retyping/re-pasting. Failure/uncertainty reports session-local notices above the transcript pane; no recovery copy, Write a new message action or uncertainty-specific gate. Availability/compaction/deletion guards remain. Local validation before clearDraft keeps the editable draft.

## Pending user turns in the transcript

- Idle and busy plain-text Enter/Send submissions (normal or steer, never followUp) create a local user preview before posting the prompt. Image turns create their preview once local image-byte preparation completes, also before posting; no Pi receipt/event is required. Idle and busy previews render identically to authoritative user turns, without sending/pending labels. Sending/pending lifecycle remains internal; only rejection/cancellation/uncertainty/disconnect adds a visible label. Slash commands are excluded because controls/expansions need not produce a literal user message. Authoritative queue snapshots also display steering text, including slash text, but never synthesize queue membership from acknowledgement.
- Previews append after all current live assistant/tool output. Actual user events adopt the preview's DOM key and authoritative position, removing its lifecycle label. Existing user history is marked seen before submissions; only newly observed user keys can consume previews. Text matching trims outer whitespace, joins text blocks, and consumes equal occurrences FIFO rather than collapsing identical steers.
- Apply queue/message observations on every host snapshot, not only on rendered frames: queue removal, consumption and clear_queue recovery can all occur within one frame. Queue removal alone is not proof of consumption, so retain the preview until a matching user message or explicit recovery. Definitive rejection/cancellation retains local turns marked Not sent/Cancelled and excludes them from subsequent user-event/queue/recovery matching. Already-authoritative Pi user turns remain untouched.
- Sending remains internally tracked until the RPC receipt, even if a queue snapshot arrives first. A user event may settle the preview before a late receipt but must never acknowledge/clear the composer. Rejected/cancelled local turns remain marked; unknown previews remain marked. Disconnect distinguishes unknown acceptance from accepted but unconfirmed delivery. Uncertain transcript previews remain marked independently of the composer; no notice dismissal or new draft implies consumption.
- Steering text leaves the status area; its authoritative pending count remains. Follow-up text and recovered Restore controls remain unchanged. Clear_queue recovery removes matching pending previews by occurrence and retains exact nonempty returned text in existing composer recovery. Image-only empty strings do not create blank Restore rows.
- Projection/aliases are renderer-local, not persisted to Pi or draft storage. Explicit sessionReset replaces the projector. Transport request correlation is runtime-only; composer state has no submission lifecycle. Retired persisted submissions are ignored and removed on the next write; reload restores only editable drafts/queue recovery, without reconstructing fictitious history or inferring acknowledgement.
- Reconciliation is intentionally conservative: Pi's user messages and queues have no submission IDs. Expanded/rewritten user content cannot safely be matched by identity, and externally cleared queues without Nimrod's recovery response cannot prove delivery. Do not infer either from counts/idle state.
- Rendering uses the existing TranscriptScroll capture/request path. No forced scroll/focus on send; no transcript render for ordinary draft keystrokes. Pending-label changes preserve assistant/tool nodes and disclosure state.

## Typing hot path

Draft-only edits retain status/control DOM and update the in-memory draft immediately. Native CSS content sizing is used where supported, otherwise one coalesced pre-paint measurement uses the latest text. Hide/dispose cancels pending sizing; selection sizes the latest draft. The fallback retains the shell-height hold/floor measurement so it cannot clamp transcript reading during measurement. Send/Stop retains its SVG unless the action changes.

Draft persistence, debounce, immediate clearing, ignored legacy drafts, image references and the performance fixture are documented in [Native drafts](native-drafts.md). The original baseline performed 160 input-handler geometry reads and 800 status/button mutations for 80 characters; the current supported-WebKit fixture performs neither, and no localStorage writes. Timings remain diagnostic, not native input-to-paint acceptance.

User guide: [Drafts](../../../../docs/drafts.md).

## Verification

`test/composer-dom.test.ts` covers idle/busy mapping, exact hint order, newline and IME guards. `test/session.test.ts` covers prompt RPC delivery and acknowledgement, including explicit follow-up requests arriving while idle. DOM/unit coverage is not native keyboard acceptance on macOS or Linux.

`test/steering-transcript.test.ts` covers FIFO duplicates, historical exclusions, event-before-receipt, authoritative queue/dequeue/recovery and disconnect labels. `test/native-view.test.ts` covers immediate safe-Markdown previews, in-place reconciliation, acknowledgement/newer drafts, coalesced clear/recovery, failures/reset, retained rejected turns excluded from reconciliation, uncertainty without recovery gates and follow-up/slash exclusions. `test/send-outcomes.test.ts` covers draft-only clearing/reload and retired-submission/backup removal. Renderer/session fixtures cover multiple sends before acknowledgement, out-of-order outcomes, unchanged identical next drafts and images captured before temporary storage release. Preparation cannot dispatch across Stop, reset or disconnect. `test/browser/steering-transcript.spec.ts` uses only the offline demo in automated WebKit to verify idle previews before gated native dispatch, stable idle/steering user articles, no duplicate/status text, preserved drafts/focus and bottom follow/older-history reading. Renderer fixtures cover idle event-before-receipt and receipt-before-event, historical duplicate exclusions, FIFO identity, idle-to-busy queue adoption, rejection/uncertainty/disconnect and idle image reconciliation. Native perceived-latency acceptance remains a user check.

User-facing behavior: [architecture](../../../../docs/writing-messages.md#steering-messages).
