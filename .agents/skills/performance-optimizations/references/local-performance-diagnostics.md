# Opt-in local performance diagnostics

**Status: implemented measurement infrastructure; not itself a speedup optimization.**

## Why we added it

The user reported jagged scrolling and delayed typing under CPU contention even in small, apparently idle sessions, while other apps remained responsive. Streaming-only theories were insufficient. We needed timing evidence from the packaged webview without provider requests, app interruption or recording conversation content.

## What was implemented

Opt-in Settings diagnostics retain bounded timing history in memory. Capture saves up to 60 seconds before a marker plus a five-second follow-up to a bounded local JSON report store. Metrics cover callback cadence, timer/event delays, input/composer/render spans, snapshot activity and focus/visibility context, with runtime/environment metadata.

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

## Interpretation limits and code anchors

Callback cadence is not compositor FPS; event timestamp age is not complete OS input latency; next-callback delay is not proof of visible text presentation. CPU utilization is not sampled. `droppedSamples` includes cumulative history-ring overwrites since enablement, so use retained sample timestamps to assess actual coverage. Focus/background throttling can distort whole-window averages.

Existing spans do not measure every reducer, timeline projection, sidebar operation, preference response, engine layout/paint or GC event. Native profiling may still be needed. No claim of Linux/possible Windows acceptance follows from macOS captures.

Code: `src/performance-diagnostics.ts`, optional probes in `src/pi/view-host.ts`/`webview-client.ts`, Settings/command routing in `src/main.ts`, and `src-tauri/src/performance_diagnostics.rs`. Tests: timing-buffer/sampler fixtures, shell capture flow, native report validation/retention and offline WebKit capture regression.
