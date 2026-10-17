# Suppress hidden-session transcript painting

**Status: implemented; regression coverage added but not run, native responsiveness/reveal-latency acceptance pending.**

## Why we chose it

Mounted background views previously ran Markdown/card reconciliation and output-scroll callbacks despite being invisible. `setActive(false)` suspended scroll bookkeeping, composer sizing and motion, but not transcript painting. This was the first deferred candidate: eliminate unnecessary presentation work before changing full-history diffing or architecture.

The later mildly sluggish macOS report contained 451 hidden paints over its retained ~45-second window (~1.3 seconds of measured render work), versus one in the prior snappy capture. This motivates the experiment; it does not establish hidden painting as the lag's cause. [Native observations](../../features/references/verification.md#performance-observation) owns those comparisons and attribution limits.

## What changed

- Inactive views retain the latest pending presentation snapshot without scheduling transcript paints. Every host message, steering/queue observation, receipt, recovery and identity transition still processes synchronously in order. Drafts, session notices, shell attention and notifications remain live.
- Hiding cancels queued transcript/output-restoration frames; presentation epochs also reject retired callbacks after hide/reveal, reset and disposal. Explicit reset/disposal still clears/releases presentation immediately, including while hidden.
- The shell reveals the root before activation. Activation synchronously reconciles the latest snapshot while transcript-follow/reader intent is still suspended, then restores scroll intent and resumes disclosure timers/composer sizing. It requires no subsequent Pi event and does not focus through a modal.
- Mounted card/plugin instances remain intact while hidden. Catch-up patches their latest data once; it does not replay intermediate presentation updates, dispose/recreate every card, or change mounted renderer selection. Cards absent from the latest snapshot are disposed at catch-up; reset/disposal remain immediate.
- Core tool-output inspection is captured with visible geometry before hide and restored on reveal, including a hide between painting and deferred output restoration. Plugin-owned registered viewports retain their existing mounted update/scroll owner.
- Automatic disclosure's unelapsed qualifying delay and minimum visible dwell pause while hidden. Catch-up supplies current lifecycle data before timers resume: tools that start/finish entirely while hidden do not auto-open on reveal; still-running unseen output begins its qualifying delay on reveal. Manual choices remain authoritative.

Canonical behavior is owned by [transcript interaction](../../features/references/transcript-interaction.md), [cards](../../features/references/transcript-cards.md), [composer](../../features/references/composer.md) and [card plugins](../../features/references/card-plugins.md).

## Intended benefits and limits

Avoid hidden Markdown parsing, transcript history diffing, renderer-managed card updates and output-restoration work; reduce UI-thread contention as concurrently working sessions increase. Background Pi reduction and arbitrary plugin-owned async mutations/timers are not eliminated. Subsequent [incremental streaming work](incremental-transcript.md) also avoids full timeline projection and unchanged shell/sidebar updates for ordinary content-only publications; structural/history/lifecycle fallbacks still perform their necessary work. Hidden views remain mounted and retain their DOM/memory. A large catch-up snapshot can still make reveal expensive.

No new native report, controlled before/after comparison or packaged reveal-latency measurement is available. Implementation and fixtures are not proof of a responsiveness improvement or macOS/Linux/possible Windows acceptance.

## Regression risks and maintenance guardrails

- **Likely erosion:** new rendering entry points, output-follow callbacks or core disclosure timers bypassing active-view suspension; using hidden transcript DOM to derive unread state, notifications, queues or authoritative activity. Arbitrary plugin-owned timers/async mutations are not suspended by this optimization.
- **Reuse the boundary:** renderer-driven presentation goes through `queueRender` and the activation/cancellation boundary; semantic state and ordered queue/receipt/recovery handling stay outside the paint gate. New deferred core work needs active/disposed/retired-generation guards. Preserve existing card/plugin instances rather than recreating them on reveal.
- **Correctness traps:** reveal geometry before catch-up and resume scroll/disclosure ownership afterward. Never capture reader intent from zero hidden dimensions, require another event to refresh, replay intermediate presentation as semantic events, or turn hide into reset/disposal. Include hides between paint and output restoration.
- **Extend fixtures when changing:** transcript/cards/plugins, activation, pending turns, notices or timer ownership. Extend the named native-view, shell, disclosure and offline WebKit fixtures below for zero hidden paints, current content without a new event, live background state, focus/inspection and reset/disposal races. Measure reveal latency separately: zero hidden paints can coexist with an expensive catch-up.

## Code and verification targets

- `src/pi/webview-client.ts`: latest pending snapshot, active frame scheduling, guarded cancellation, synchronous reveal, output inspection and live recovery notices.
- `src/pi/tool-disclosure.ts`: paused qualifying delay/visible dwell, latest lifecycle on resume.
- Existing shell reveal ordering and `TranscriptScroll` suspension remain the geometry/intent boundary; ordered Pi transport/reduction are unchanged.
- `test/native-view.test.ts`: zero hidden render probes/scheduled frames under 100 snapshots, one synchronous catch-up, raced callbacks, independent outputs, reader/follow intent, hidden queue consumption and outcomes, retained plugins/local state, modal focus, notices and hidden reset/disposal.
- `test/tool-disclosure.test.ts`: deterministic clock coverage for remaining qualifying delay, visible dwell, hidden completion, manual choices and disposal.
- `test/shell.test.ts`: foreground/background streaming retains zero unchanged-state IPC, background attention stays live, hidden DOM stays stale until synchronous reveal.
- `test/browser/hidden-session-painting.spec.ts`: offline WebKit DOM-mutation counter, real-layout reader/follow and two inspected outputs, latest hidden content, retained drafts and repeated switching. Existing workspace/steering/queued/plugin suites remain required regressions.

Tests/checks/builds were not run for this implementation. When requested, run `mise run test` and `npm run test:browser`; then compare packaged responsiveness and reveal latency under representative background-session load. No app/window interruption or live model requests are authorized by this catalogue.
