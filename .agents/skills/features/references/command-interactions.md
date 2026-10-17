# Command interactions

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#command-interactions) retain prior execution records.

Human guide: [Command interactions](../../../../docs/command-palette.md#pickers-and-cancellation).

## Specification and acceptance criteria

One interaction owns every palette page and entry point. Escape cancels the whole interaction, Back alone returns to commands, accepted actions run after focus restoration, and stale results cannot mutate or reopen canceled pages.

## Ownership and extension points

`src/command-palette.ts` owns the window-local command interaction. Commands, session pickers, model/thinking selections and naming are pages within that interaction—not a stack of parent dialogs. `src/main.ts` supplies commands and session-bound preference operations; `src/keybindings.ts` supplies entry-point dispatch. `index.html` supplies the shared modal and Escape hint.

Color-theme preview uses `startPreviewSelection()` with lifecycle-owned rollback; see [themes](themes.md#bundled-catalog-and-command-palette-picker). Its hover handling is preview-only and leaves other picker behavior unchanged.

Read-only MCP inspection uses `startInspection()` in the same lifecycle: details follow the selected row, Enter does not execute a row action, Refresh replaces the page generation, and Escape/Back/cancellation suppress stale presentation. See [MCP inspector](mcp-inspector.md).

Add a picker through `startSelection()` or the existing page lifecycle, not a feature-specific dialog key handler. `beginPage()` owns query reset, Back/Retry controls and request generation. Page content may differ; dismissal must not branch on page mode or entry point. There is no new generic harness or global modal framework.

Repeated deletion is one deliberate nested-dialog interaction: the shared deletion session page stays mounted and visible while its tree review owns focus and Escape. Only that executing page authorizes review coverage; all other dialogs retain priority. Cancel leaves the picker unchanged; successful tombstones prune cached rows in place after settlement without rediscovery or rebuilding survivors. Escape from the picker dismisses the interaction. Generation/disposal guards reject stale completions after API closure or newer pages; no automatic reopening. See [deletion picker](session-deletion.md#repeated-deletion-picker).

Project navigation is another shared page, not a separate modal controller; see [recent-project picker](projects-and-sessions.md#recent-project-picker). Its recent-directory page uses inline project rows and has no OS folder-chooser action; native File Open / Cmd/Ctrl+O is separate.
Command-list sorting and accepted-command history are independent of page lifecycle; see [Command ranking](command-ranking.md). Subordinate picker order is unchanged.

## Retained permission interaction

`startRetainedSelection` is the shared presentation lifecycle used by
[Copilot permissions](copilot-sdk.md#permission-choices-and-interaction).
It refuses to replace an already-open dialog; its standalone page hides
application Back/Retry and does not enter command rankings. `show` supplies
operation context and choices, `remaining` patches only header text, and `focus`
restores the filter only when no child/higher-priority dialog is open. Choosing
runs the guarded page action without closing the shell; the concrete owner
advances it or explicitly cancels it when empty.

Escape/native close still dismisses the whole palette interaction and invalidates
callbacks synchronously. Unlike `chooseItems`, this API does not own a harness
decision promise: dismissal notifies the concrete owner, which leaves its queue
pending behind a Review requests banner. It never translates Escape into denial.
A nested host input dialog is a deliberate exception for denial feedback: only
the top modal handles Escape; cancellation returns to the mounted picker, submit
advances it. Owner-generation/AbortSignal guards retire both on cancellation.
Existing one-shot selections and post-close application actions are unchanged.

## Copilot harness choices

[Copilot SDK slash commands](copilot-commands.md) can request modal choices through
`startSelection(..., standalone:true)` and `chooseItems()`. Rows retain opaque
IDs and supplied labels/descriptions; standalone pages hide application Back and
Retry. They reuse Escape, close-time focus restoration and stale-page guards,
without registering app actions or ranking usage. The shell checks exact session,
connection, presentation, Settings/modal state and the command's AbortSignal;
background/late results never open or replace a modal. Switching away, Stop and
disconnect cancel the owning command interaction. Existing palette model actions
remain independent. Authored command/palette/shell fixtures are unrun.

## ACP POC commands

Only registered product actions enter the palette/shared shortcut dispatcher. `new-acp` and `acp-options` are removed; their saved overrides are inert. Generic ACP adapters remain internal, with no creation/options pages. Pi and Copilot contribute their supported session actions, revalidated against the originating session. Resume and Delete use their separate history/deletion sources. Model/thinking controls keep session-bound choices; background or stale results never open another session's picker. [ACP scope](acp-harnesses.md#command-palette-ownership) records the retained infrastructure boundary.

The [presentation extraction rationale](harness-presentation.md) documents this internal contribution boundary, distinct from public card-content plugins. New/updated extraction and mode fixtures pass in the full offline gates; native acceptance remains pending.

## Lifecycle contract

- Escape from any control and the native dialog `cancel` event call `closeInteraction()` with no action. Public `close()` and an active selection request's `cancel()` use the same path. All dismiss the entire interaction; none invoke commands or navigate backward.
- `closeInteraction(action?)` is the sole controlled close boundary. It synchronously invalidates request generations, resolves a pending choice to `undefined`, clears naming/Retry callbacks, and closes the modal. Metadata RPCs may finish in the background, but cannot update or reopen a dismissed page or mutate a preference through a canceled choice.
- Resume passes an AbortSignal and generation-bound page publisher to history composition. Each source/page can publish usable rows before other sources finish; these rows are actionable without waiting for all discovery. Closing, Back, Refresh, replacing the page or disposal aborts the consumer and rejects stale publications. This does not stop project-owned discovery or send ACP turn cancellation. Resume sorts each publication by displayed recency across sources after overlaying open rows; equal times retain source order. The current query/selected identity is retained across incremental results.
- Successful selection/naming passes an action to that same boundary. The native `close` event restores the original workspace focus before running the accepted action in a microtask. Canceling is distinct from accepting an action; failure never replays it.
- Native `close` events are queued. New interactions are blocked while closing, so a previous close event cannot invalidate a new page, replace its opener, or steal its focus. Activation also requires an open dialog. Duplicate input after closing is inert.
- The close listener retains cleanup for external/native closes. Focus restoration checks that the opener is connected, visible/not inert, and no higher-priority dialog is open.
- Only the explicit Back button calls `commands()`. Back cancels pending choice/naming state, invalidates stale results and restores the command query while keeping the modal open. Naming retains its compact UI without a Back button.
- IME/229 remains excluded from keyboard cancellation/activation. Native modality and the shell dispatcher preserve higher-priority Pi dialogs. Genuine nested dialogs (Pi extension above the palette, recorder inside Settings) retain their own cancellation; Escape is not a global close-all-dialogs command.

## Model and thinking-level selection markers

`SelectionRequest.choose()` maps Pi's acknowledged current value to `PaletteItem.current`, independently of the navigation index. Selection pages render an aria-hidden typographic `•` in a fixed 14px `.palette-selection-marker` slot for every row (empty for unselected values); `src/workspace.css` sizes it at 1.1em with the separator's muted foreground. No session-indicator primitive, circle background or Current subtitle is used. The Open recent project page reuses this marker/blank-slot presentation with `PaletteItem.projectOpen` rather than `current`: dots mean open project-window membership (potentially multiple rows), not the current project. Project-specific CSS narrows only that page's dot slot to 8px with a 4px name gap (model/thinking slots remain 14px); the right-aligned Enter hint follows `aria-selected` visibility with its space always reserved. It uses an accessible Open project window label rather than `aria-current`; Open remains a search alias. `aria-current=true` exposes the current value, while the existing `aria-selected`/`aria-activedescendant` contract continues to track keyboard navigation. Row highlights and hover remain separate from the bullet, including after filtering. Pi acknowledgement, cancellation and focus behavior are unchanged.

## Regression coverage

- `test/command-palette.test.ts`: all current page kinds and a future-feature selection, direct/palette entry, keyboard/native/API dismissal, pending-choice cancellation, deferred native close, stale metadata, explicit Back/query retention, accepted action after focus restoration, IME/repeated Enter and refresh/error paths.
- `test/shell.test.ts`: direct session/model/thinking shortcuts and status controls now assert one-Escape closure, with drafts, session lifecycle and prompt-free behavior retained; Pi dialog priority is unchanged.
- `test/browser/preferences.spec.ts`: both picker bullet markers, blank-slot label alignment and separator-relative size, independent keyboard/hover highlights, and acknowledged effort changes without submitting the draft.
- `test/browser/keybindings.spec.ts`: direct shortcuts dismiss in one press and retain composer focus/draft.
- `test/browser/workspace-tabs.spec.ts`: offline streaming continues under the palette; explicit Back retains the command query and one Escape from Resume restores the untouched composer. Naming cancellation retains the live session.

Run `mise run test` and offline `npm run test:browser`. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow). Fixture/WebKit coverage does not establish native Tauri focus acceptance or Linux/Windows parity. Do not launch or interrupt the user's app for validation.
