# Performance diagnostics

**Status: implemented; native macOS report collection observed, with instrumentation overhead and broader platform acceptance pending.** User guide: [Performance reports](../../../../docs/performance-diagnostics.md). Related: [preferences](preferences.md), [composer](composer.md), [transcript interaction](transcript-interaction.md), [keybindings](keybindings.md).

## Contract

- `diagnostics.performance` is a validated boolean, default **false**, in the existing JSONC settings file. Global Settings → Diagnostics persists it through the shared CAS writer; valid changes synchronize across project/welcome windows. Each window has independent history and captures. Reference pop-outs do not install these samplers.
- Enabling does not connect/start/restart Pi or send anything. Disabled diagnostics schedule no timers/animation frames or event listeners; optional renderer probes execute their original work without reading clocks or storing samples.
- Enabled diagnostics retain timing-only samples in a fixed 4096-entry ring. Capture freezes up to the preceding 60 seconds and collects another five seconds into a separate 4096-entry ring. The resulting report includes a capture marker, monotonic start/end offsets and performance time origin. Delayed timers/suspension can lengthen the follow-up period; it is not a hard real-time five-second deadline.
- `droppedSamples` is conservative: history-ring overwrites **since enabling** plus frozen-capture-ring overwrites. It can include history already outside the requested minute. Saturated reports never claim complete coverage. Enabling recently naturally supplies less than a full minute.
- Capture is explicit through the project window's `capture-performance` command-palette action (or configured shortcut). The separate global Settings window hides its capture button and points to the project command rather than capturing the Settings window. The action is registered/bindable with no default shortcut, through the shared dispatcher. Concurrent capture requests cannot start a second collector/writer. Shortcut eligibility requires enabled diagnostics and no active capture; the palette action when disabled explains where to enable it through the shared notice strip.
- Capture never changes composer state, transcript intent, focus, session ownership or Pi event/acknowledgement order. Project-local capture progress/success and the exact saved path use informational entries in the existing application notice strip (stable `performance-capture` ID, canceled progress resolved explicitly); the palette action's detail also retains the last path for this window lifetime. It does not automatically navigate/open dialogs or copy to clipboard.
- Disabling clears the in-memory ring, removes samplers/listeners and cancels a pending five-second capture. Disposal does the same. A native write already dispatched may finish; cancellation does not delete previous reports.

## Timing model and interpretation

- A lightweight animation-frame callback aggregates count, total interval and maximum interval into approximately one-second `frame-summary` samples. Intervals ≥50 ms additionally produce `frame-gap`. This measures JS pre-paint callback cadence, **not actual compositor presentation**, and does not assume a 60 Hz display.
- A 250 ms heartbeat stores only timer lateness ≥50 ms (`timer-delay`). No synchronous storage or serialization occurs on interaction/sampler paths.
- Passive capture listeners record numeric event timestamp age for `key-delay`, `input-delay`, `wheel-delay` (≥16 ms) and `scroll-delay` (≥16 ms). No key, event target, text, wheel delta or scroll position enters the report. Epoch timestamps normalize to performance time origin; invalid, negative or ≥60-second ages are omitted. Browser timestamp semantics may exclude OS/input queue time; these are not end-to-end input latency.
- `input-next-frame` measures receipt of the earliest coalesced input event to the next JS pre-paint callback; it does **not** prove that edited text was visibly presented then.
- Optional view-host probes record actual composer input-handler time, composer sizing-helper time and full transcript-paint time. Snapshot samples count delivery to each mounted view, including hidden ones. `active` distinguishes selected versus hidden session views, without identities. Composer timing includes the existing native field-sizing short circuit or fallback measurement, not engine layout after the helper returns. Ordered snapshot processing remains synchronous and unchanged.
- Visibility transitions flush frame summaries and reset baselines/cancel samplers while document-hidden, avoiding a false huge frame gap on resume. Focus/blur are contextual markers; visible but unfocused throttling may still appear as delayed cadence. No App Nap/QoS/priority behavior is changed.
- Environment: browser user agent, native CSS field-sizing support, configured zoom, device pixel ratio, reported logical hardware concurrency; Rust adds app version, native webview runtime version when available, OS, architecture, debug/release flag and save timestamp. No CPU utilization/process list is collected. Webview runtime versions/user agents alone are not a complete installed OS/WebKit build fingerprint.
- UI gaps with low measured handler/render cost warrant native scheduling/paint profiling. A report cannot distinguish CPU starvation, GC, uninstrumented JS, engine layout/paint and OS compositing conclusively. This task does not claim a slowdown diagnosis or responsiveness fix.

## Storage and privacy

Default: `~/.local/state/nimrod/performance/performance-<unix-ms>-<uuid>.json`, beneath the **existing resolved native state directory**, honoring absolute `XDG_STATE_HOME` and the established portable home fallback. Reports are separate from settings, bookkeeping, drafts and Pi files. Nothing is uploaded.

Native payloads are typed, deny unknown fields, enumerate metric names and allow only numeric/boolean sample fields. Validate finite nonnegative monotonic timings, capture interval order, ≤4096 samples, ≤512-byte user agent, environment ranges and ≤1 MiB serialized report. Prompts, responses, key values, credentials, session IDs/paths, project names and arbitrary labels are not accepted as sample fields. Fixed-schema environment user-agent metadata is the only frontend string.

Writes run on a blocking worker, serialize through a report-writer mutex, stage in a private tempfile and atomically persist without clobbering another report. Unix report permissions are 0600. Keep at most 20 recognized report filenames; do not remove unrelated files or symlinks. Report file creation/pruning failures use the shell's shared notice strip; the writer rechecks enabled preferences before dispatch. Storage errors are not automatically retried. A pruning failure can leave more than 20 files and reports the already-saved path in its error; storage failure is not hidden as successful retention.

## Code map

- `src/performance-diagnostics.ts`: fixed ring, samplers, visibility lifecycle, ordered metric probes, frozen capture and cancellation.
- `src/pi/view-host.ts`, `webview-client.ts`: optional timing probes only; no harness protocol additions.
- `src/settings-surface.ts` owns the window-local diagnostics instance and exposes only its `performanceProbe` for renderer instrumentation; `src/main.ts` supplies that same probe to every mounted view. Keep sampling, capture, preference synchronization and disposal on the owning instance—do not create a second sampler or reference a retired shell-local instance after extraction.
- `src/main.ts`, `src/settings-surface.ts`, `index.html`, `settings-navigation.ts`, `keybindings.ts`: Settings controls, synchronized enablement, bindable capture, local result path and shared errors.
- `src/preferences.ts`, `src-tauri/src/preferences.rs`: boolean schema/CAS synchronization.
- `src-tauri/src/performance_diagnostics.rs`, `main.rs`: native typed validation, environment, bounded private report storage and command registration.

## Verification

- `test/performance-diagnostics.test.ts`: fake-clock offline sampler cadence/stalls, cap/overwrite visibility, time-window filtering, content exclusion, hidden suspension, cancellation/disposal and disabled no-work path.
- Preferences/keybinding tests: default-off schema, last-valid settings, comment preservation, binding overrides/unbinding.
- `test/shell.test.ts`: actual bundled shell/renderer against mock IPC; bindable opt-in capture, report path, no content/session paths, failures through the shared strip, cancellation and retained draft/focus/session nodes with no prompts/restarts. Added integration assertions require input-handler, composer-layout, snapshot and transcript-render metrics from mounted views in the owning window's report; these assertions have not been run for the probe-wiring fix.
- Native fixture tests: typed content/unknown-metric rejection, size/negative/unordered timing validation, private report writes, 20-report retention and unrelated-file preservation.
- Offline WebKit capture regression: real Settings/palette flow, content exclusion, retained draft/focus/disclosure/reading position and error/cancellation routing. Native IPC/storage is mocked; no user session/model work.

User-supplied packaged macOS reports and feedback establish local report collection and limited observed responsiveness recovery after unchanged-write suppression; see the canonical [native performance observation](verification.md#performance-observation). They do not isolate instrumentation overhead or prove the lag's sole cause.

Run `mise run check` and offline `npm run test:browser`. No automatic app builds or user-window interruption. Instrumentation overhead, broader session/history scaling, compositor correlation and Linux/possible Windows behavior remain unverified; do not infer native latency acceptance from fixtures.
