# Performance reports

Use local timing reports to investigate sluggish typing or scrolling. Diagnostics are **off by default** and do not start agents or make model requests.

## Capture a slowdown

1. Open **Settings → Diagnostics** and turn **Performance diagnostics** on.
2. Return to your project and use Nimrod normally. Allow about a minute if you want a full minute of preceding history.
3. When the app feels sluggish, open the command palette and choose **Capture performance report**. The same button is available in Settings → Diagnostics.
4. Continue the interaction for another five seconds while capture finishes.
5. Open **Settings → Diagnostics** to find **Report saved:** and its exact file path. Share that path with your coding assistant for local inspection, or share the JSON file yourself. No data is sent automatically.

The command has no default shortcut. You can assign one in **Settings → Keybindings** to mark a slowdown without opening the palette. Captures belong to the window where you invoke the command; enabling/disabling diagnostics synchronizes across project windows. Reference pop-outs are not sampled.

History and reports have sample caps, so captures contain **up to** the preceding 60 seconds, plus a five-second follow-up. Recent enablement supplies less history; intense event traffic can overwrite samples, explicitly reported by `droppedSamples`. Suspension or an overloaded UI can delay completion beyond five seconds.

Turning diagnostics off stops sampling, clears memory and cancels an unfinished recording. A file save already dispatched may still finish. Existing reports remain on disk. Capture does not change your draft, focus, reading position, tools or running sessions.

## What is recorded

- Animation-frame cadence and unusually long gaps.
- Event-loop timer delays and numeric keyboard/input/wheel/scroll event timestamp delays.
- Input-handler, composer-sizing and transcript-render durations, including visible versus hidden-session activity.
- Visibility/focus transitions, capture timestamp, zoom, display scale, field-sizing support and logical CPU count.
- Nimrod version, native webview runtime version when available, browser user agent, platform and debug/release build flag.

**No prompt text, responses, key values, credentials, project names, session IDs or session paths are recorded.** Reports contain timing/environment data only. Sampling adds some work; its overhead in the packaged app under heavy CPU load still needs native validation.

## Local files

By default, reports are saved under:

```text
~/.local/state/nimrod/performance/
```

Absolute `XDG_STATE_HOME` overrides the root, as with Nimrod's other [local state](settings.md#configuration-files). Windows uses the established home-directory fallback. Files use `performance-<timestamp>-<uuid>.json` names. Nimrod keeps 20 recent reports, each capped at 1 MiB; Unix files are private to your user. You can delete these report files without affecting conversations or preferences. A retention/storage failure appears in the shared [notice strip](error-messages.md).

You can also enable diagnostics by adding this boolean to `settings.json`:

```jsonc
"diagnostics.performance": true
```

## Limits

Frame samples describe JavaScript pre-paint callbacks, not actual screen presentation. Input timing does not include every part of the OS input queue. Reports can identify expensive Nimrod work versus unexplained UI stalls, but cannot conclusively identify CPU scheduling, garbage collection, WebKit layout/paint or OS compositing as the cause. A native profiler trace may still be needed.

The performance-report flow has fixture coverage; packaged-app slowdown diagnosis and Linux/possible Windows native behavior remain unverified.
