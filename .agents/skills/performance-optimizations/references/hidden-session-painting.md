# Suppress hidden-session transcript painting

**Status: deferred candidate. Suggested priority: first; medium interaction risk.**

## Why

Each session is mounted in the same project document. In `src/pi/webview-client.ts`, `queueRender` schedules a paint without checking whether the session is active. `setActive` suspends transcript scroll bookkeeping, composer resize frames and motion, but does not stop transcript reconciliation/DOM work.

Consequently a connected background session can parse Markdown, update tool/plugin DOM, scan history and schedule output-scroll work that the user cannot see. Report samples confirmed hidden-view render activity. A later mildly sluggish capture contained 451 hidden paints in its retained ~45-second window, versus one in the prior snappy capture; [native observations](../../features/references/verification.md#performance-observation) owns the comparison and limits. That association motivates this candidate but does not establish hidden painting as the remaining lag cause.

## Potential benefits

- Reduce UI-thread CPU and allocation pressure from background streaming.
- Leave more scheduling headroom for the selected session's typing and scrolling.
- Scale better with the number of concurrently working sessions.
- Avoid hidden geometry reads and unnecessary DOM/plugin updates.

This does not eliminate background Pi reduction, timeline projection, notifications or arbitrary plugin-owned timers. Do not claim that hidden sessions become computationally free.

## Experiment outline

Keep processing every host message and ordered session transition. Retain only the latest pending presentation snapshot while inactive; schedule one catch-up paint on reveal. Cancel/guard already scheduled paints when hiding or disposing so they cannot mutate a retired view.

Revisit shell reveal ordering and `TranscriptScroll.setActive` together: catch-up content must use valid revealed geometry without treating layout growth as reader navigation. Define catch-up behavior for tool-disclosure timers and card/plugin lifecycle explicitly; delaying DOM updates is not permission to change semantic lifecycle or dispose/recreate all cards.

## Constraints and current contracts

Read [transcript interaction](../../features/references/transcript-interaction.md), [cards](../../features/references/transcript-cards.md), [composer](../../features/references/composer.md) and [card plugins](../../features/references/card-plugins.md).

Retain queue/steering observations, receipts, recovery, errors, drafts and identity changes even when no paint occurs. Hidden-session notifications/attention remain live. Switching must retain inspected output, manual disclosures and follow/reader intent, show current content without another incoming event, and not steal focus through a modal. Explicit reset/disposal remains distinct from hide/show.

Primary code anchors: `src/pi/webview-client.ts` (`queueRender`, host-message handler, `setActive`), `src/pi/transcript-scroll.ts`, and shell activation in `src/main.ts`.

## Validation target

A background-only streaming fixture should produce **zero hidden transcript paints** after suspension while continuing to reconcile ordered state. On reveal, assert the latest content, pending-turn lifecycle, stable existing tool nodes, disclosures, per-tool inspection and older-history/bottom-follow behavior.

Extend `test/native-view.test.ts`, `test/shell.test.ts` and offline WebKit workspace/steering/queued-transcript regressions. Include hide between scheduling and frame delivery, completion/consumption within one hidden interval, repeated switching, resets, disposal and custom-renderer updates. Measure saved paint work and reveal latency separately; packaged responsiveness and platform behavior still need native evidence.
