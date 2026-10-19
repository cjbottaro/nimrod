# Operation cards

**Status: configuration, Pi steering/queued and failed-send preview migration source-implemented; new/updated fixtures unrun.** This reference owns the shared presentation pattern. Concrete features own execution, completion, cancellation and persistence. It is not a universal harness protocol. Human guide: [Reading conversations](../../../../docs/reading-conversations.md#operation-cards).

## Structure and typography

An **Operation card** represents a Nimrod-initiated operation from pending intent through its outcome. It contains a stable **title**, meaningful **content**, optional **outcome text**, optional **details disclosure**, and an optional **Cancel** control.

- Titles name the operation, not its lifecycle: **CONFIGURATION CHANGE**, **STEERING**, **QUEUED**. Never change configuration titles to “Changing configuration” or “Configuration changed.”
- Every state uses the existing Queued/Steering title typography: inherited system-UI font, `0.78em`, normal weight, uppercase presentation and `0.05em` letter spacing. Only the title shimmers, never content/the whole card.
- Content describes intent concretely (`Model: GPT-6.1 Sol`, `Thinking level: medium`, or the submitted message), permits wrapping/multiple lines and remains across transitions. Outcome information is additional, not a replacement for identity/content.
- Reuse user-turn-like padding, background, accent-line geometry, gutters and inter-entry spacing. Use theme tokens, not hardcoded colours.

## States

| State | Placement | Shimmer | Accent | Additional presentation |
| --- | --- | --- | --- | --- |
| Pending | Shared bottom-pinned stack | Yes | Normal | Cancel only if supported |
| Succeeded | Normal transcript flow | No | Normal | No redundant success label |
| Failed | Normal transcript flow | No | Error red | **Failed**, **Error details** disclosure when available; known Copilot slash-command failures use only a concise wrapping inline error |
| Outcome unknown | Normal transcript flow | No | Muted grey | **Outcome unknown**, **Details** when available |
| Not applied | Normal transcript flow | No | Muted grey | **Not applied**, **Details** when available |
| Confirmed user cancellation | Removed | — | — | No retained cancellation receipt |

Outcome unknown means the operation may have taken effect without confirmation. Not applied means it is known not to have taken effect. Connection loss alone does not determine which: the concrete owner supplies the outcome. Text accompanies colour; cancellation is not automatically an error.

## Pending and settlement

- Create immediately after local validation accepts intent. The common bounded stack stays pinned at the transcript-pane bottom, independently scrolls when long and stays visible while reading older history without enabling auto-follow.
- Queued/preparing/applying remain pending until the owner establishes a terminal outcome. A transport/enqueue acknowledgement is not necessarily completion.
- Same-operation replacement updates the retained card when supported. Supersession of dispatched work remains feature-specific.
- Settlement stops shimmer, unpins and retains the mounted card/title/content. Capture the position at the ordered outcome snapshot, not a later paint. Anchor local markers after the then-current non-sticky tail, or before future entries when empty. Later entries never drag settled markers to the bottom.
- If an operation synchronously produces its own transcript result before its
  terminal publication, its concrete owner may capture the pre-result boundary
  at intent acceptance. Settlement uses that explicit boundary so the operation
  precedes its own output; unrelated configuration operations retain
  outcome-snapshot anchoring.
- An authoritative harness user event adopts its existing preview at the harness's position instead of inserting a second receipt. Retain the runtime operation title on that adopted article. Do not write operation metadata into harness history or reconstruct it on Resume.
- Coalesced/hidden rendering cannot change settlement ordering. If history replacement removes a local anchor, settle once at the remaining tail (or empty start).
- No forced scrolling/focus, draft changes, replay or repeated navigation. Existing local Send auto-follow policy still applies at submission, never at acceptance.

## Cancellation

Cancellation is an optional capability, not a promise attached to every pending card.

- Safely withdrawable queued intent: remove the intent and card synchronously.
- Dispatched work with actual cancellation support: retain pending presentation, show **Cancelling…** in content and await confirmation. Remove only on confirmed cancellation; if completion wins, show its actual outcome.
- Unsupported cancellation: omit Cancel. Never equate hiding an entry with withdrawing its work.
- Failed cancellation does not establish failure of the original operation. Present its known outcome or uncertainty; never silently remove potentially delivered work.
- Stop agent does not implicitly cancel operation cards unless a concrete feature says so.
- Restore focus only if the disappearing Cancel control owns focus, to the owning composer with `preventScroll`; never override another focused control.

## Errors and accessibility

Disclosures start collapsed, appear only when diagnostics exist, preserve full diagnostic text and retain their open state across updates. The operation card owns its operation-specific failure; do not duplicate that failure in a session banner. Independent session-wide problems remain session notices. Errors before an operation card exists retain notice routing. [Error presentation](error-presentation.md) owns those boundaries.

Copilot slash-command failures with a known rejected outcome are the compact
exception: show the actionable harness error inline in conversation typography,
with the red accent but no separate **Failed** label or disclosure. Strip
transport and Nimrod retry/fallback boilerplate; do not discard the actual
harness message. Unknown/not-applied command outcomes retain their explicit
outcome labels and diagnostic disclosures.

Expose operation state accessibly, independent of colour/animation. Reduced motion uses readable static titles; inactive/hidden views pause animation and defer painting, not semantic state processing. Preserve keyed nodes, disclosures, reader/follow intent and the existing single scroll owner. Cancellation and uncertainty never trigger automatic retries.

## Concrete consumers

- [Slash commands](../../slash-commands/SKILL.md#command-cards): **Command
  cards** are specialized operation-card consumers. They retain one invocation
  card in the bottom-pinned stack while queued, collecting interaction, waiting
  for concrete harness readiness or invoking, then unpin into normal flow and
  adapt the same card to report output, confirmed state change, concise
  rejection, agent-prompt transition or uncertainty. Command results do not
  become a separate response row unless the harness reports an independent
  conversation operation.
- [Live permissions](live-permissions.md): Nimrod's **Set permissions…**
  action uses **PERMISSION CHANGE** with an independent configuration owner.
  Harness `/permissions` submissions remain Command cards and use generic
  advertised readiness. Both leave old approvals pending; no provider checks
  belong in the renderer.
- [Configuration](model-thinking.md): stable **CONFIGURATION CHANGE**, literal setting/value content, runtime-only local marker. Offer Cancel only when all work represented by that card can still be withdrawn; do not remove evidence of already-applied changes. Rejection/uncertainty details belong in the card. Unavailable selections rejected before intent remain notices.
- [Pi steering and queued messages](composer.md): stable **STEERING** / **QUEUED** while pending and after authoritative adoption. Both are pinned while pending. RPC acknowledgement and queue removal do not settle them; only the matching authoritative user event does. Keep occurrence-based FIFO, image correlation and harness position. No per-entry Cancel: Pi's available `clear_queue` is whole-queue recovery, not targeted withdrawal; do not emulate it by clearing/replaying other entries. Explicit whole-queue recovery retains its existing Restore workflow. Ordinary idle previews remain ordinary user turns, without a pending operation title.
- These semantics do not automatically convert tool cards, permission requests, application notices or all user turns to operation cards.

## Implementation and verification targets

Code: `src/operation-card.ts` owns the shared mounted header/footer; `conversation-view.ts` integrates content, scrolling, focus and card-owned receipt errors; `configuration-transcript.ts` / `pi/steering-transcript.ts` project concrete lifecycle/placement. `session-configuration.ts` and concrete adapters own cancellation/dispatch tracking. `main.ts`, `session-backend.ts` and `keybindings.ts` route the card and palette's owner-bound cancellation action. `ConversationView.hasConnectionOutcome` is only a notice-deduplication query, not a delivery/connection state source.

Share the mounted title/outcome/details/cancel presentation across consumers; keep lifecycle decisions in their concrete controllers/projectors. Same-key progress patches exact dirty rows without lazy history reads; insertion/unpin/removal uses existing structural reconciliation. Ordered lifecycle observation must precede the hidden/coalesced paint gate.

Required fixture coverage: pending-to-success identity and placement, empty-history and hidden/coalesced settlement, red failures, grey uncertainty/non-execution, full diagnostics and retained disclosure, safe cancellation/removal/focus and dispatch races, unchanged drafts and independent reader intent, no duplicate banners, reduced motion and shared stack geometry. Pi cases retain receipt-before/event-before acknowledgement, duplicates, normalized images, queue recovery, no replay and authoritative message content.

Authored coverage: `test/operation-card.test.ts`, configuration/controller/projector, Pi configuration, shared/native view, steering projector and existing offline Copilot/steering/queued/delivery-status browser fixtures, plus `test/browser/operation-cards.spec.ts` for retained title typography, reduced motion and themed outcome accents. Shell configuration-error coverage expects card details instead of duplicate notices; keybinding defaults include the unbound cancellation action. Migration tests are unrun; no app was launched. Ordinary idle previews retain no pending title; their failed/unknown receipts use MESSAGE cards instead of duplicate banners. The mandatory post-merge compile check is not behavioral/native acceptance. Native macOS visual/focus/scroll acceptance and Linux/possible Windows verification remain pending. Requested layout validation uses `mise run test` and `npm run test:browser`; builds and live harness work require separate authorization.
