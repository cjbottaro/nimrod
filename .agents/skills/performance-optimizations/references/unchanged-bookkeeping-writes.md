# Suppress unchanged bookkeeping writes

**Status: implemented. Provenance: commit `683f890`, selected during the CPU-contention investigation.**

## Why we chose it

Every session publication, including background streaming, called `persistTabs`. Before this change the shell enqueued a state IPC request even when the saved layout was identical, and native storage rewrote the state file without an equality guard.

Performance reports showed substantial animation/keyboard delays despite cheap measured composer/render handlers. This persistence path was outside those spans. Removing known redundant IPC/storage work was a bounded, lower-interaction-risk experiment than changing transcript rendering, moving controllers to workers or adjusting process priority.

## What changed

The shell uses `saveStateIfChanged` to skip a request when its JSON value matches the latest queued value for that key, or the last received native state when nothing is pending. Explicit and conditional writes share pending tracking. Native `change_state` refreshes/validates files and merges/version-normalizes state before skipping an unchanged file replacement.

Actual layout/recency changes still save at their original boundaries. Ordered Pi event processing, optimistic local UI, draft storage, transcript rendering and scrolling were not changed. Native command response/broadcast routing was not rewritten; frontend suppression avoids making the redundant request in the first place.

Current safeguards and implementation are owned by [Preferences → Unchanged bookkeeping writes](../../features/references/preferences.md#unchanged-bookkeeping-writes), not this summary.

## Benefits

- Avoid unnecessary per-event state IPC, queued preferences operations, file replacements and corresponding request/response work.
- Reduce background-session contention without deferring real persistence changes.
- Prevent unchanged native state mutations from advancing revision or rewriting external formatting.
- Retain A → B → A ordering, external-state visibility and failure handling rather than treating optimistic local state as durable success.

## Results

A bundled-shell fixture with 200 foreground/background streaming deltas plus four lifecycle events produced **204 extra state IPC calls before suppression and zero after**. Selection and rename still persisted; streaming output, draft and focus were retained. Native fixtures verify unchanged file bytes/revision, preservation of unrelated external edits, recreation after deletion and malformed-file guards.

The user subsequently reported snappy typing/scrolling with CPU usage still near saturation. Supplied packaged macOS reports improved from ~21–22 callbacks/sec and 32–46 ms median keyboard-event delay in earlier sluggish captures to ~59 callbacks/sec after focus and 5 ms median delay in the post-change snappy capture.

A later report showed milder degradation with much more background presentation activity. That is evidence of remaining opportunities, not proof that this optimization failed or removed every bottleneck. [Verification → Performance observation](../../features/references/verification.md#performance-observation) owns the complete comparison and caveats.

## Regression risks and maintenance guardrails

- **Likely erosion:** adding per-token timestamps, counters or transient activity to persisted layout makes every snapshot different; bypassing conditional saves reintroduces redundant IPC even if native disk writes are suppressed. Keep runtime-only metadata out of durable layout unless persistence is actually required.
- **Reuse the boundary:** routine shell bookkeeping should use `saveStateIfChanged` and the shared queued writer, not direct state IPC or an independent last-value cache. Explicit writes remain available for operations that genuinely require them; do not indiscriminately suppress all saves.
- **Correctness traps:** compare against the latest queued value, not only committed state. Preserve A → B → A ordering, captured caller values, failure recovery and native external-file refresh/validation before equality checks.
- **Extend fixtures when changing:** session-layout schemas/callers, write queues or native state storage. Retain the bundled-shell streaming IPC counter plus preferences/native cases for real selection/rename writes, mixed explicit/conditional requests, failed writes, caller mutation and external edit/deletion. Check avoided work as well as durable outcomes.

## Limits and code anchors

The native observations are not a controlled A/B: CPU utilization was reported rather than sampled, session/restart state and event traffic differed, and reports lack a unique source-build revision. They support observed improvement, not sole-cause attribution or universal platform acceptance.

This change does not stop hidden painting, sidebar projections, full-history diffing or draft staging IPC. Frontend no-op comparison uses received snapshots, with the existing polling/external-writer visibility boundary.

Code: `src/preferences.ts` (`saveStateIfChanged`, pending state writes), `src/main.ts` (`save`, `persistTabs`), `src-tauri/src/preferences.rs` (`change_state`). Tests: preferences/native preferences and the bundled-shell foreground/background streaming regression.
