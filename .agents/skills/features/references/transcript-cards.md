# Transcript cards

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#transcript-cards) retain prior execution records.


## Specification and acceptance criteria

One mounted card per invocation survives placement/lifecycle updates, preserving manual disclosure, output reading position and connected indicator identity. Full raw content remains accessible without summary hover tooltips.

## Code map and invariants

- `src/pi/tool-call.ts`: common partial tool-call merge and standalone-envelope conversion. Both reducer and renderer parse standalone inputs through this model, so input previews match assistant-embedded cards. Lifecycle rank is running → finished → result; stale earlier-phase events cannot rewind status/output/errors. Complete late assistant arguments remain authoritative.
- `src/pi/reducer.ts`: execution/result upserts and assistant-content reconciliation by `toolCallId`. Standalone `role: "tool"` messages remain a placement envelope, not a different card model. Missing assistant content stays standalone; matching start/delta/end/history content consumes only that ID's envelope. Repeated toolcall_start retains existing execution state.
- `src/pi/webview-client.ts`: per-view tool-node registry keyed `tool:<id>`, falling back to placement-scoped keys only for missing IDs. Creating from either envelope or assistant content reuses the same details node on placement changes; manual disclosure, disclosure timers, indicator identity and per-card output inspection survive. Clear registry on explicit session reset/dispose and prune removed cards after reconciliation. Never share this registry across sessions. Capture/restore output scroll per card, not per assistant article (an article can contain multiple tools).
- `src/pi/transcript-presentation.ts`: standalone tools have an accessible article label but no redundant visible `TOOL: …` prefix.
- `src/pi/tool-card.ts`: incremental tool-card summary, indicator, input preview, raw inputs and output rendering.
- `src/pi/tool-disclosure.ts`: qualifying-update delay, minimum open dwell and manual-choice precedence.
- `src/pi/reasoning-card.ts`: Pi-provided reasoning disclosure and first-line preview.
- Card summaries, indicators and previews have no `title` attributes: hovering does not show native tooltips, including after streaming/lifecycle updates.
- Preserve summary `aria-label` status descriptions, visible previews, raw inputs and expanded reasoning. Full content remains available by expanding the disclosure rather than hovering.
- Code Copy/Pop out button tooltips and status/composer controls are unaffected.
- Preserve connected spinner/disclosure nodes, manual toggle precedence, automatic disclosure timing and output scrolling; see [transcript interaction](transcript-interaction.md) and the disclosure contract below.

## Disclosure specification and acceptance criteria

- Generation, execution output, final result and result processing are distinct states; late earlier-phase updates must not rewind completion.
- Cards start closed. Only sustained nonempty execution output qualifies for auto-open after `TOOL_AUTO_DISCLOSURE_MS` (500ms); a final result alone never qualifies.
- Manual open/close choices override automatic lifecycle disclosure. Auto-open has a 500ms minimum dwell; preserve the existing scheduler rather than replacing it with result-driven opening.
- Live/final output viewports retain their eight-line/sixteen-line visual caps; these limit viewport height, not source content. Full raw inputs/results remain readable.
- Placement changes must reuse one call-ID-keyed mounted shell, preserving connected indicators, disclosure timers and independently inspected output offsets.
- Safe Markdown/code rendering, accessibility, Copy/Pop out and summary tooltip policy remain unchanged.

## Tests and remaining acceptance

`test/tool-call.test.ts`, `test/tool-input-lifecycle.test.ts`, `test/native-view.test.ts` and `test/transcript-presentation.test.ts` cover both source orders, results-first history, missing assistant content, duplicate updates, late assistant input precedence, stable DOM identity during placement changes, manual disclosure, session reset and independently preserved multi-tool output inspection. `test/tool-card.test.ts` and `test/reasoning-card.test.ts` assert absence of tooltip attributes on initial rendering and updates while retaining accessible status labels. These DOM tests do not establish native hover acceptance; validate the packaged app visually without launching or interrupting the user's window automatically.
