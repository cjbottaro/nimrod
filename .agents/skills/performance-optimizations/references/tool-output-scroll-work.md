# Limit tool-output scroll work to affected viewports

**Status: deferred candidate. Suggested priority: third remaining; high scroll-regression sensitivity.**

## Why

Each `renderState` captures streaming-output positions across the tool-card registry and schedules restoration callbacks for connected cards, even when many cards are untouched by the update. The capture/restore helpers read geometry and write scroll offsets. Managed card renderers also maintain keyed output positions internally.

These paths protect independent inspection, but broad bookkeeping can add selector scans, layout reads and callback work proportional to tool-card count. Finished cards without a live viewport already short-circuit; quantify the eligible viewport count rather than assuming every historical tool forces layout.

## Potential benefits

- Fewer geometry reads, scroll writes and animation callbacks during streaming.
- Less risk of forced layout from interleaved DOM/geometry work.
- Better scaling with many live/expanded tool outputs.
- More scheduling headroom for transcript scrolling and input.

## Experiment outline

Identify the actual owners and overlap between outer streaming-output helpers and `DomCardController`'s registered viewports before changing either. Track affected cards/output sections and capture their intent before mutation; restore only viewports whose content or geometry can change.

Batch eligible restorations into a guarded frame where practical, retaining per-output intent rather than one shared follow flag. Include disclosure, lifecycle-cap, width/zoom and theme/layout changes in invalidation; text equality alone is not enough to decide geometry is unchanged.

## Constraints and current contracts

Read [transcript interaction](../../features/references/transcript-interaction.md), [cards](../../features/references/transcript-cards.md) and [card plugins](../../features/references/card-plugins.md).

A reader inspecting one output must not jump to its bottom because another tool updated. Preserve bottom-follow separately for every output and for the transcript. Keep streaming/final viewport caps, manual disclosure precedence, call-ID identity and supported custom-renderer viewports. Do not infer reader intent from zero hidden dimensions; handle removal/reset/disposal before delayed callbacks run.

Primary code anchors: `src/pi/webview-client.ts` (`outputPositions` and restoration loop), `src/pi/card-shell.ts` (`captureStreamingOutput`, `restoreStreamingOutput`), `src/pi/dom-card-renderer.ts`, `src/pi/tool-card.ts` and `src/pi/transcript-scroll.ts`.

## Regression risks and maintenance guardrails

This candidate is not implemented; narrower scroll invalidation must be proven against the existing independent viewport owners.

- **Likely erosion:** new output sections/plugins bypass affected-viewport tracking, or text-only checks overlook geometry changes from disclosure, terminal caps, width/zoom, themes or asynchronous content. Broad fallback scans can silently restore the original scaling cost.
- **Reuse the boundary if implemented:** capture before mutation and restore through the existing core/card-controller output owners and registered keyed viewports. Coordinate their responsibilities rather than removing one as supposedly redundant; never substitute one session-wide follow flag.
- **Correctness traps:** preserve each inspected output independently from siblings and transcript follow. Guard deferred work across hide/reveal, removal/reset/disposal, retain pending restoration intent, and never infer bottom-follow from zero hidden geometry.
- **Extend fixtures when changing:** output types/registration, layout policies or plugin async mutation. Extend tool-card/DOM-renderer/native-view and offline WebKit cases below with many eligible outputs but one changing viewport; assert unaffected offsets and reduced geometry/restoration counts alongside lifecycle, disclosure and zoom correctness.

## Validation target

For a fixture with many eligible tool-output viewports but one changing output, geometry reads and restoration work should scale with **affected viewports**, not all eligible cards. Completely unchanged cards should not receive redundant restoration writes.

Retain tool-card/DOM-renderer/native-view tests for multiple independently inspected outputs, supported plugins, streaming-to-final transitions and disposal. Extend offline WebKit coverage for collapse/expand, hidden/revealed sessions, fractional zoom, width changes and paused versus following outputs. Run the full required scroll regression suite; geometry counters are not native trackpad acceptance.
