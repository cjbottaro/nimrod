# Composer delivery and keyboard hints

## Code map

- `src/pi/composer-dom.ts`: keyboard delivery mapping and hint ordering.
- `src/pi/webview-client.ts`: busy-state hints, keyboard submission, draft receipts and compaction lock.
- `src/pi/session.ts`: authoritative session-state gate and Pi prompt RPC.
- `src/pi/steering-transcript.ts`: live pending-turn projection, queue reconciliation and user-turn key aliases.
- `src/pi/webview-client.ts`: applies every ordered snapshot before coalesced painting; patches pending-status labels in the existing user article.

## Contract

- Idle: Enter sends normally; Option-Enter also sends normally, never queues. Hints: `Enter to send · Shift+Enter for newline`.
- Main agent working: Enter steers; Option-Enter queues a follow-up. Hints: `Enter to steer · Option-Enter to queue · Shift+Enter for newline`.
- Option is the macOS name for the Alt modifier (`KeyboardEvent.altKey`); Linux uses Alt+Enter. The current hint text uses the macOS label.
- Shift+Enter and IME input are not consumed by submission mapping.
- The controller sends `streamingBehavior: followUp` only for explicit `followUp` delivery while its main agent is busy. All other prompts include `steer`, preserving idle-to-busy race handling. If the controller is already idle after a busy renderer snapshot, the submission uses the ordinary steering fallback.
- Compaction locks submission and replaces keyboard hints with its cancellation hint. Background-only activity does not enable queueing.
- Keep acknowledgement/draft behavior unchanged: only Pi acknowledgement clears an unchanged submitted draft; never replay uncertain acceptance.

## Pending steering in the transcript

- Busy plain-text Enter/Send submissions (normal or steer, never followUp) create a local user preview before posting the prompt. Slash commands are excluded because controls/expansions need not produce a literal user message. Authoritative queue snapshots also display steering text, including slash text, but never synthesize queue membership from acknowledgement.
- Previews append after all current live assistant/tool output. Actual user events adopt the preview's DOM key and authoritative position, removing its lifecycle label. Existing user history is marked seen before submissions; only newly observed user keys can consume previews. Text matching trims outer whitespace, joins text blocks, and consumes equal occurrences FIFO rather than collapsing identical steers.
- Apply queue/message observations on every host snapshot, not only on rendered frames: queue removal, consumption and clear_queue recovery can all occur within one frame. Queue removal alone is not proof of consumption, so retain the preview until a matching user message or explicit recovery. Do not match rejected/cancelled previews to subsequent messages.
- Sending stays marked until the RPC receipt, even if a queue snapshot arrives first. A user event may settle the preview before a late receipt but must never acknowledge/clear the composer. Rejected/cancelled/unknown previews remain marked; disconnect distinguishes unknown acceptance from accepted but unconfirmed delivery. Allow another send does not retry or erase an uncertain preview.
- Steering text leaves the status area; its authoritative pending count remains. Follow-up text and recovered Restore controls remain unchanged. Clear_queue recovery removes matching pending previews by occurrence and retains exact returned text in existing composer recovery.
- Projection/aliases are renderer-local, not persisted to Pi or draft storage. Explicit sessionReset replaces the projector. Existing persisted uncertain submissions still use composer recovery on reload, without reconstructing fictitious history or inferring acknowledgements from saved messages.
- Reconciliation is intentionally conservative: Pi's user messages and queues have no submission IDs. Expanded/rewritten user content cannot safely be matched by identity, and externally cleared queues without Nimrod's recovery response cannot prove delivery. Do not infer either from counts/idle state.
- Rendering uses the existing TranscriptScroll capture/request path. No forced scroll/focus on send; no transcript render for ordinary draft keystrokes. Pending-label changes preserve assistant/tool nodes and disclosure state.

## Verification

`test/composer-dom.test.ts` covers idle/busy mapping, exact hint order, newline and IME guards. `test/session.test.ts` covers prompt RPC delivery and acknowledgement, including explicit follow-up requests arriving while idle. DOM/unit coverage is not native keyboard acceptance on macOS or Linux.

`test/steering-transcript.test.ts` covers FIFO duplicates, historical exclusions, event-before-receipt, authoritative queue/dequeue/recovery and disconnect labels. `test/native-view.test.ts` covers immediate safe-Markdown previews, in-place reconciliation, acknowledgement/newer drafts, coalesced clear/recovery, failures/reset and follow-up/slash exclusions. `test/browser/steering-transcript.spec.ts` uses only the offline demo in automated WebKit to verify stable user articles, no duplicate/status text and preserved bottom follow/older-history reading. Validation in `.worktrees/transcript-steering`: offline `mise run check` passed 387 TS/Node tests, formatting, Clippy and 97 Rust tests (two real-Pi tests intentionally ignored); `mise run build` passed macOS app packaging/signature verification; the full `npm run test:browser` suite passed 43 automated WebKit tests. One repeat check during parallel build/browser validation hit the unchanged Rust `single_instance::tests::lock_holder_without_listener_times_out_without_becoming_primary` fixture's `Option::unwrap()`; a subsequent standalone full check passed all 97 Rust tests. Native Pi/macOS and Linux acceptance remain unverified; no user app was launched.

User-facing behavior: [architecture](../../../../docs/architecture.md#steering-messages).
