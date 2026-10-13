# Make Session sidebar updates change-driven

**Status: deferred candidate. Suggested priority: second; medium navigation/focus risk.**

## Why

`PiSession.publish` invokes the shell's `changed` callback for routine streaming events. That callback calls `updateTab`, which updates row/control attributes and calls `renderSidebar`. The sidebar then recomputes projections/counts, captures/restores viewport geometry and walks rows even when token output changes none of the sidebar's visible properties.

The current renderer already preserves mounted rows and moves only out-of-order nodes. This proposal targets **redundant calls and projection/geometry work**, not an imaginary full sidebar rebuild. Unchanged bookkeeping-write suppression is already implemented separately.

## Potential benefits

- Reduce UI-thread work per foreground and background token update.
- Avoid redundant DOM attribute writes and sidebar geometry reads.
- Make streaming cost less dependent on open-session count.
- Reduce interference with sidebar reading and keyboard focus.

## Experiment outline

Derive a small presentation signature or explicit dirty state for each row: title, timestamp, indicator, selected state and action eligibility. Patch a row only when its presentation changes. Invalidate list projections/counts only when membership, activity/attention, ordering, selection, filter or relevant lifecycle/deletion eligibility changes.

Keep transcript/status/model updates independent; a row no-op must not suppress required work elsewhere. Prefer existing navigation projections and targeted invalidation over a second sidebar state machine or timer-based debounce.

## Constraints and current contracts

Read [sidebar views](../../features/references/sidebar-attention.md), [session navigation](../../features/references/session-navigation.md), [sidebar resizing](../../features/references/sidebar-resize.md) and the [optimistic interaction policy](../../features/references/architecture.md#optimistic-interaction-policy).

Local Send recency and sidebar-to-top feedback must remain immediate, independent of RPC results. Working/Unread membership, arrival order, selected-row retention, failure/input attention and controls must update at their existing boundaries. Preserve minute/foreground timestamp refresh, filter focus recovery, sidebar reading position, shared Switch/cycling order and deletion-lock eligibility. Session notices must not become sidebar failure indicators.

Primary code anchors: `src/main.ts` (`changed`, `updateTab`, `renderSidebar`), `src/session-sidebar.ts`, `src/session-navigation.ts`, `src/session-attention.ts` and `src/session-recency.ts`.

## Validation target

After establishing the working indicator, repeated text-only deltas with unchanged row presentation should perform **no sidebar-wide projection/geometry work or row mutations**. Actual busy/idle/input/failure, rename, local Send, selection, filter, close and deletion transitions must still update immediately.

Count calls/mutations in bundled shell fixtures with increasing session counts. Retain navigation/recency/attention unit tests and offline WebKit workspace/sidebar/notification regressions, including focused/filtered rows and background arrivals. Measure idle-row versus actual-transition costs separately; do not infer native responsiveness from DOM counters alone.
