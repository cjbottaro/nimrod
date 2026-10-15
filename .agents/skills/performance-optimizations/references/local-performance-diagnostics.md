# Opt-in local performance diagnostics

**Status: implemented measurement infrastructure; not itself a speedup optimization.**

## Why we added it

The user reported jagged scrolling and delayed typing under CPU contention even in small, apparently idle sessions, while other apps remained responsive. Streaming-only theories were insufficient. We needed timing evidence from the packaged webview without provider requests, app interruption or recording conversation content.

## What was implemented

Opt-in Settings diagnostics retain bounded timing history in memory. Capture saves up to 60 seconds before a marker plus a five-second follow-up to a bounded local JSON report store. Metrics cover callback cadence, timer/event delays, input/composer/render spans, snapshot activity and focus/visibility context. Version 2 adds bounded event/reduction/projection/shell/sidebar/bookkeeping work aggregates with explicit nesting/self time and logical rows-visited counts, plus marker/end appearance context and native build-checkout metadata. New aggregate/storage/clipboard fixtures are authored, not run; this instrumentation expansion is not an optimization or native acceptance.

Disabled diagnostics do not install samplers/listeners. Reports do not capture prompt/response text, key values or session/project identities. [Performance diagnostics](../../features/references/performance-diagnostics.md) owns exact sampling, privacy, limits and storage contracts; [the user guide](../../../../docs/performance-diagnostics.md) owns usage.

## Benefits

- Distinguish expensive instrumented application handlers from delays outside them.
- Compare subjective sluggish/snappy observations using the same metric definitions.
- Identify background presentation activity and motivate bounded avoided-work experiments.
- Collect local evidence without copying conversations, sending model requests or guessing from unit-test timing alone.

Instrumentation adds work; its overhead has not been isolated in a controlled native comparison.

## Results

User-supplied packaged reports captured ~21–22 callback deliveries/sec and substantial keyboard delays in sluggish conditions, versus ~60/sec once settled and much shorter delays in snappy conditions. Composer handlers stayed cheap across both, exposing a gap in coverage of the rest of the shared event/persistence pipeline.

After unchanged-write suppression, the user reported improvement under high CPU load and supplied a report supporting that perception. A later mildly sluggish capture showed ~51 callbacks/sec, higher tail keyboard delay and 451 hidden transcript paints in its retained window. These observations make the deferred [hidden-painting candidate](hidden-session-painting.md) worth considering; they do not establish its causal impact.

[Verification → Performance observation](../../features/references/verification.md#performance-observation) is the canonical result summary rather than duplicating raw reports here.

## Report lookup and maintenance guardrails

For “look at the latest performance report”, use the greatest timestamp-only `YYYY-MM-DD_HH-MM-SS.mmmZ.json` name in the resolved native state root's `performance-captures/` directory (default `~/.local/state/nimrod/performance-captures/`; honor absolute `XDG_STATE_HOME` or use the exact saved path when supplied). Read only regular recognized report files, not symlinks/unrelated JSON. Old UUID reports stay in `performance/` and are historical, not silently selected as new captures. Command-palette/action success copies the saved path; clipboard failure is distinct from save failure.

When adding instrumented work, extend the closed TS/Rust metric/schema together, reuse the owning window's probe and record no identities/content. Keep synchronous ordering/exception semantics and disabled no-clock behavior. Aggregate frequent work rather than adding per-token samples; extend nesting, caps/overwrite, privacy, native validation and shell capture fixtures. Retain appearance/source context and distinguish missing fields in legacy version-1 reports from false/zero values.

## Interpretation limits and code anchors

Callback cadence is not compositor FPS; event timestamp age is not complete OS input latency; next-callback delay is not proof of visible text presentation. CPU utilization is not sampled. `droppedSamples` includes cumulative history-ring overwrites since enablement, so use retained sample timestamps to assess actual coverage. Focus/background throttling can distort whole-window averages.

New work aggregates cover named reducer/projection/sidebar paths, but do not measure every transport response, preference broadcast, async IPC/storage operation, engine layout/paint or GC event. Inclusive parent/child totals overlap; compare self-time or same-scope totals rather than summing nested costs. Aggregate maxima/counts are not per-event latency percentiles. Native profiling may still be needed. No claim of Linux/possible Windows acceptance follows from macOS captures.

Code: `src/performance-diagnostics.ts`, optional probes in `src/pi/view-host.ts`/`webview-client.ts`, Settings/command routing in `src/main.ts`, and `src-tauri/src/performance_diagnostics.rs`. Tests: timing-buffer/sampler fixtures, shell capture flow, native report validation/retention and offline WebKit capture regression.
