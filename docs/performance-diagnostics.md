# Performance reports

Use local reports to investigate sluggish typing or scrolling. Diagnostics are **off by default** and do not start agents or make model requests.

## Capture a slowdown

1. Open **global Settings → Diagnostics** and turn **Performance diagnostics** on.
2. Return to your project and use Nimrod normally. Allow about a minute for preceding history.
3. When the app feels sluggish, open the command palette and choose **Capture performance report**. Capture targets this project window, not the separate Settings window.
4. Continue the interaction for another five seconds while capture finishes.
5. The project window’s notice strip shows **Report saved:** and the exact path. The command also **copies that path to your clipboard**. Reopening the palette shows the last path in the action’s detail. Share the path with your coding assistant, or ask it to look at the latest report in the folder below. Nothing is uploaded.

The command has no default shortcut. Assign one in **global Settings → Keybindings** to capture without opening the palette; the same action copies the saved path. A clipboard failure reports **Report saved** with the path and a separate copy error—the file remains available, and nothing is automatically retried.

Captures belong to the invoking window; enablement synchronizes across project windows. Reference pop-outs and the separate global Settings window are not sampled. Capture does not change your draft, focus, reading position, tools or running sessions.

History contains **up to** the preceding 60 seconds plus a five-second follow-up. Recent enablement supplies less history. Timing samples and aggregated work have independent caps/overwrite counters (`droppedSamples`, `droppedWorkSamples`); these counters include earlier history overwritten since enablement, not just missing data from this capture. Suspension or overload can delay completion beyond five seconds.

Turning diagnostics off stops sampling, clears memory and cancels unfinished recording. A file save already dispatched may still finish. Existing reports remain on disk.

## What is recorded

- Animation-frame callback cadence, long gaps and event-loop timer delays.
- Numeric keyboard/input/wheel/scroll event timestamp delays and input-to-next-callback timing.
- Input-handler, composer-sizing and transcript-render durations; selected versus hidden session activity.
- Aggregated Pi event handling, state reduction, tool timeline projection, snapshot delivery, shell updates, sidebar row/list work and bookkeeping preparation.
- Work call counts, total/self/maximum duration and logical rows visited by sidebar reconciliation.
- Visibility/focus transitions, capture marker, zoom, display scale, field-sizing support and logical CPU count.
- Configured opacity/frosting/area and effective appearance opacity/area, frost capability and Reduce Transparency state at the capture marker and follow-up end.
- Nimrod version, native webview version when available, browser user agent, OS/architecture, debug/release flag, source revision, dirty/unknown state and build timestamp.

**No prompt text, responses, key values, credentials, project names, session IDs or session paths are recorded.** Build metadata records no repository paths. Sampling adds work; packaged instrumentation overhead remains unverified.

### Reading work aggregates

Version-2 reports add a bounded `work` array, grouped into roughly one-second buckets by metric, measured parent and selected/hidden context. `count` is calls (or logical rows for `sidebar-rows`); `totalMs` includes nested measured work; `selfMs` excludes directly nested work-probe durations; `maxMs` is the maximum single call. Do **not** add parent and child totals together. Raw input/render samples can also overlap these spans. Aggregates do not provide per-call percentiles or actual DOM-mutation/layout counts.

`startedAtMs` is the earliest included operation start, and `atMs` is bucket flush time. Buckets flush at capture/visibility boundaries and may cover longer intervals when delivery is delayed. Whole buckets crossing the requested history boundary are retained, not proportionally trimmed. Appearance snapshots describe the marker/end, not every moment of preceding history, and do not prove native blur was successfully installed.

## Local files and “latest report”

Default directory:

```text
~/.local/state/nimrod/performance-captures/
```

Absolute `XDG_STATE_HOME` overrides the root, as with Nimrod's other [local state](settings.md#configuration-files). The established home-directory fallback remains portable.

Files have **UTC timestamp-only names**, for example:

```text
2026-10-14_12-34-56.789Z.json
```

There is no UUID. The greatest timestamp filename is the latest capture; don't use file modification times or unrelated JSON files. Same-millisecond collisions and backwards wall clocks advance the filename timestamp rather than overwrite an existing file; `savedAtUnixMs` retains actual wall-clock save time.

Nimrod keeps 20 recognized captures, each capped at 1 MiB; Unix report files are private to your user. Unrelated files and symlinks are not pruned. Existing UUID reports in the old `performance/` folder are left untouched, not moved or deleted. You can delete report files without affecting conversations or preferences. Storage/retention failures use the [application notice strip](error-messages.md).

You can also enable diagnostics in global `settings.json`:

```jsonc
"diagnostics.performance": true
```

## Limits

Frame samples describe JS pre-paint callbacks, not actual screen presentation. Event delays omit some OS input-queue time. Work probes preserve synchronous processing and cover named application paths—not all transport responses, asynchronous storage/IPC, garbage collection, WebKit layout/paint or OS compositing. A native profiler may still be needed if measured application work stays cheap during stalls.

A dirty source revision plus build timestamp identifies a build context, not an exact dirty-source fingerprint. In development, native build identity does not establish which frontend revision the dev server serves. Older version-1 reports lack the new context and aggregates; missing data is not zero work or disabled transparency.

The new version-2, timestamp-storage and clipboard fixtures are authored but not run for this change. Packaged overhead, clipboard behavior and Linux/possible Windows native acceptance remain unverified.
