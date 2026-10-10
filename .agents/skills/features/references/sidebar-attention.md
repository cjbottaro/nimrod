# Session sidebar views: implementation reference

Read the [human guide](../../../../docs/workspace-sessions.md#sidebar-views) and
[UI vocabulary](../../nimrod-ui-vocabulary/SKILL.md). Paths below are repository-root relative.

## Code map

- `index.html`: All / Unread / Working tablist, shared tabpanel, live session counts and empty-state status with stable text/ellipsis nodes.
- `src/workspace.css`: compact view tabs, theme-token colors; existing session rows and conversation geometry remain intact.
- `src/session-attention.ts`: pure window-local inbox ordering and selected-row retention.
- `src/session-recency.ts`: timestamp validation/monotonic use ordering, identity-bound closed-session cache, stable All sort, zoom-aware viewport anchoring and explicit row reveal.
- `src/session-sidebar.ts`: pure relative/date formatting and indicator precedence; visible-only minute/foreground time-label refresh with disposal.
- `src-tauri/src/sessions.rs`, `session_catalog.rs`: bounded read-only `lastUserMessageAt` metadata shared by catalog/exact-file inspection. `session_deletion.rs` prunes confirmed successes from closed-project recency caches.
- `src/main.ts`: attention reasons, `isWorking` membership shared by counts/filter/empty status, view persistence, minimal row moves/visibility, focus and keyboard navigation.
- `src/pi/session.ts`: existing Pi attention callback for live settled completion, final run/process failures; input dialog lifetime is tracked by the shell's `withTabDialog`.

Per-row trash/Close controls are siblings of the conversation-selection button in all three views. Trash targets that row without changing selection or recency; see [session deletion](session-deletion.md#sidebar-row-action) for eligibility, confirmation and cleanup.

## Membership and resolution

`needsAttention(tab)` is inputCount > 0, unread completion, or a failure flag.

- Completion comes only from the existing Pi `attention('completed')` callback: live `agent_start` followed by idle `agent_settled`. Another presented session, Unread hiding the remembered session, or Settings covering the conversation makes completion unread. History, ordinary snapshots, `agent_end`, intermediate retry errors and tool output do not create unread work.
- Visiting clears unread completion. It does not answer a dialog or clear a failure.
- `inputCount` tracks outstanding shell-mediated Pi input/select/confirm dialogs (including a Pi `/name` input), until their promise resolves/cancels. Pending dialogs retain their existing global modality and originating session identity. The palette's local name/model steps are not outstanding Pi dialogs.
- Final run/process failures use existing `attention('failed')`. Startup/resume/stop/restart notices also flag the session through `showNotice`. Generic extension notifications and isolated tool errors are not failures.
- A new non-compacting, available busy run clears a prior failure. Explicit relaunch clears it at its start; a failed launch/stop restores it. Merely reading never clears it. There is no manual dismiss in this first pass.
- Desktop notification settings/focus suppression do not govern sidebar membership. No new OS alerts are emitted by the sidebar itself.
- Existing token, close/restart and unload guards remain authoritative; do not derive failure from arbitrary status strings or infer semantics from historical messages.

## Stable ordering and selection

`SessionAttention.reconcile` retains the current inbox order, removes closed/resolved unselected sessions, and appends new attention arrivals. Order is independent of the `tabs` array and repeated activity. No timestamps or recency sort.

A resolved row already in the inbox remains while selected. The count measures actual outstanding attention, so a retained read row may coexist with count 0. It disappears after selecting another session. Unresolved input/failure remains regardless of selection. Explicitly selecting a non-attention session through the palette/shortcuts switches to All before showing its conversation. New/resumed sessions follow the same rule. It never inserts an ordinary session into the inbox.

All sorts a copy of `tabs` by descending `lastUsed`; underlying open order remains unchanged for stable ties, Switch session and cycling. New (saved/named/temporary/demo) seeds creation time with `nextLastUsed(tabs)` and inserts at the top, including same-millisecond creations/clock rollback. Resume seeds the maximum valid remembered recency and historical `lastUserMessageAt`, never mtime or resume time. Exact-file/last-session opens use read-only inspection when no seed is available. Legacy unknown layout entries are inspected before insertion; UI session actions stay disabled through that asynchronous initial restoration. Late metadata cannot resurrect a confirmed deletion or create duplicates. Unreadable legacy entries/drafts remain for explicit recovery, without fabricated timestamps.

`lastUserMessageAt` is the latest valid timestamp among persisted Pi user-message records, across stored branches; it is navigation metadata, not a composer acknowledgement or reconstruction of active Pi context. Prefer nested numeric message milliseconds, falling back to the record's RFC3339 timestamp (including offsets). Ignore assistant/tool/rename/compaction/control entries, malformed/nonpositive/out-of-range timestamps and file mtime. Existing exact-file/catalog byte/record limits and read-only behavior remain. No new live history polling, Pi launch, transcript replay or uncertain-draft clearing for this metadata.

Live `touchTab` remains exclusive to `SessionUi.promptAccepted` after successful `prompt` RPCs (ordinary/steering/follow-up); `/name` accepts its composer receipt after `set_session_name` without this hook. Unknown/rejected/canceled submissions never advance recency. Selection, cycling, reading, model/metadata changes, compaction, snapshots, background output/completion and automatic Close/deletion selection do not mark use. Do not reconnect navigation or timer refresh to `touchTab`. Timestamp validation rejects unsafe integers and values outside JavaScript Date's range; monotonic advancement handles same-millisecond use/clock rollback. Sidebar Up/Down/Home/End follow displayed order; Switch session/cycling still cover all open entries independently of the filter.

`renderSidebar` hides row wrappers and moves only out-of-order existing nodes; never rebuild rows or transcripts, dispose renderers, start/stop children, clear drafts, or focus the composer in response to a filter change. It uses `captureSidebarScroll` to preserve the first surviving visible row at the same pixel offset, not merely preserve scrollTop. The deliberately moved row is excluded so an acknowledged send never chases it to the top. Row clicks do not move rows at all. Fallback is the previous scrollTop if no visible anchor survives. Rect deltas are normalized to layout pixels for native and fixture CSS zoom; `overflow-anchor:none` avoids competing browser anchoring. Focus on a DOM-moved row is restored with preventScroll, without changing the focused element. `revealSidebarRow` changes only sidebar scrollTop for explicit palette/shortcut/New/Resume navigation or returning to All. Sidebar row clicks disable that reveal; restoration and automatic replacement also disable it. Focus on a filtered-away row/Close falls back to the selected view tab, unless a dialog owns focus. Browser scroll clamping when content becomes shorter is unavoidable.

## Row time and state presentation

`rowTime` is a mounted `<time>` inside the secondary `small`, with a machine-readable `datetime` and a unique `aria-describedby` link from the row. Format `relative time · local date`; include the year when it differs from the current year. Sub-minute/future-relative values show Just now; missing timestamps show No message time. Minute/hour/day/month/year precision has no second-level ticking. One visible-only 60,000ms window timer and visibility/focus listeners refresh text on foreground return; they never call `renderSidebar`, persist state, request IPC/history, navigate or refocus. Dispose them on unload. Write only changed text/attributes; no live region or row tooltip.

State remains in the row's accessible name and the left indicator's `data-state`. Precedence: deleting/recovery/restarting/closing/starting, input, failure, inactive/unavailable, compaction/working (including known subagents), unread, pending receipt, ready. Unread completion outranks an otherwise idle pending receipt: a response can settle before its acknowledgement, without permission to clear the draft or advance recency. Hollow circle = inactive, small dot = ready, ringed dot = unread, ? = input, ! = failure, ↻ = recovery. Working/sending/lifecycle transitions share a stable CSS ring; distinct accessible labels preserve their meanings. A deletion preview/confirmation lock does not change the underlying indicator: the `deleting` indicator input reflects `Tab.deletionExecuting`, not the `Tab.deleting` safety lock. Only the native post-confirmation quarantine/shutdown phase starts the Deleting ring, and unlocking clears it. Working counts/membership exclude the entire deletion transaction. Spinners respect reduced motion. Switch session uses the same `createSessionRowContent`/`updateSessionRowContent` DOM helpers, `updateSessionRowTime` formatting and `.session-row`/`.session-indicator` styling as sidebar rows. Its `PaletteItem.sessionRow` carries timestamp and the shell's existing indicator result, not a separate status string. Both show title above muted relative time/date, with indicator-only visible state and an accessible status name; Switch keeps status/Current search keywords without a visible Current prefix or status tooltip. Resume history previews and Open badges remain independent.

## Conversation visibility and blank surface

`active` remembers the navigation target for returning to All and cycling;
`presented` identifies the conversation actually visible. `sidebarTabs` retains
resolved rows only for `presented`, not a hidden remembered selection.
`presentConversation` owns renderer activation, mounted root visibility/inertness,
current-row markers, mode badge, action eligibility and pop-out selection.
Restore parent/root visibility before activating the renderer so scroll geometry
is measured in the shown pane.

- A shown conversation must have a selected row in the current sidebar view.
  Entering Unread from a working/idle session without attention hides
  the entire conversation area, including transcript, status and composer. Do
  not automatically select another attention row. This also applies when the
  inbox contains other rows but none is selected.
- An empty Unread view has no conversation, empty-project buttons or
  prompts. Keep the Project bar and sidebar (including its working/idle status).
  Clear the session-mode badge; disable Restart/Delete; omit selected-session
  palette actions and ignore Cmd/Ctrl+W when no conversation is presented.
- Hide, never unload: suspend renderer geometry through `setActive(false)` and
  retain DOM, drafts, disclosures, follow intent/reader position and live children.
  Returning to All shows the remembered session without composer focus or a
  filter-triggered launch. Inactive entries still require explicit selection to
  resume. Persisted attention views boot blank without launching hidden sessions.
- Completion of a hidden remembered session is unread and eligible for the
  existing background notification policy. New rows never automatically present
  their conversation or steal focus. Pending Pi dialogs keep existing modality.
- A completed row explicitly visited in Unread stays selected after its
  unread flag clears, so the response remains readable. This is not permission to
  retain an unrelated working session when entering the view.
- Explicit Switch session, cycling (even one hidden session), New and Resume
  reveal a target outside the inbox in All, persisting that view. Automatic
  Close replacement stays in the current view; if no eligible row remains, the conversation stays blank, with any remaining session remembered only for All. Successful tree deletion batches removals, selects next/previous in displayed order, and falls back to All when attention has no candidates; see [session deletion](session-deletion.md). Closing a hidden row never changes the presented conversation.
- Focus inside a newly hidden pane/row falls back to the current view tab unless
  a dialog owns focus. Hiding the sidebar itself does not hide the conversation;
  the invariant concerns view membership, not whether navigation is collapsed.
- Pop-outs synchronize with `presented` (null while blank), not `active`, so no
  reference window remains visible for an invisible conversation.

## Working view and counts

All counts all open `tabs`; Unread counts `needsAttention`; Working counts `isWorking`. Counts remain visible at zero, can overlap, and exclude retained resolved rows from the filtered counts. Header count text changes only when its value changes; muted parenthesized counts wrap as a unit at narrow sidebar widths.

`isWorking` requires an available session, no starting/closing/restarting/deleting/ended or input-waiting state, and authoritative `state.busy` (including compaction) or Pi-reported subagent activity via `presentActivity`. `agent_end` is not settlement. No polling, historical inference, new harness request or process lifecycle change.

A second window-local `SessionAttention` instance tracks working membership/selected-row retention; the displayed Working rows are sorted by `recentSessions`, not arrival time. It reconciles on routine sidebar renders. Retention applies only while Working is selected; a selected run can settle without hiding the response being read, while its count falls to zero. Leaving the view removes that retention. A run arriving while blank does not open itself. Explicit filtered-out navigation switches to All; Close remains blank when exhausted, deletion falls back to All. Working shares the existing mounted conversation, focus, draft, scroll and pop-out boundaries.

ArrowLeft/ArrowRight wrap All → Unread → Working; Home selects All and End selects Working. Roving tabindex and the panel's `aria-labelledby` follow the selected view.

## Empty-view working status

When Unread has no visible rows, `renderSidebar` counts live, available Pi sessions whose authoritative state is busy (including compaction). Starting/closing/restarting, ended/unavailable and input-waiting sessions are excluded. Display `1 session working…` or `N sessions working…`; only a zero count displays `No unread sessions.`. All's empty message remains `No open sessions.`. A retained selected row still suppresses the empty status.

The count is informational: it does not add working sessions to the inbox or change the attention badge. `agent_end` and compaction completion do not independently clear busy state; wait for Pi's reducer/snapshots to do so. No polling, native focus lookup or new harness requests.

Keep the status text and ellipsis nodes mounted, updating text only on actual count/state transitions so snapshots do not reset the CSS animation or repeatedly announce unchanged live-region text. Ellipsis is aria-hidden, pulses opacity without changing geometry, and stops animating under `prefers-reduced-motion: reduce`.

## Storage and boundaries

Sidebar width is independent of these views and recency; see [sidebar resizing](sidebar-resize.md) for its project-scoped app-state key, edge handle, zoom normalization and responsive caps.

App-managed state key: `nimrod.sidebar.view:<canonical cwd>` contains `all`, `unread` or `working`. Legacy `attention` restores as Unread and the next selection writes the new value. Missing/invalid values default All. It uses the existing Preferences state writer, not user settings or Pi session files. Each mounted window retains its chosen view; external state updates do not rebuild it.

The open layout remains `nimrod.tabs.v1:<canonical cwd>` with additive per-entry `lastUsed`; first-save identity promotion carries creation/accepted-message recency into the verified canonical file. Previously persisted valid timestamps, including old selection-derived timestamps, remain compatible. `nimrod.recency.v1:<canonical cwd>` additionally maps canonical file paths to `{ sessionId, lastUsed }`, retaining recency after Close. The session ID must match before reuse; replaced files cannot inherit another session's timestamp. This cache holds no titles/conversation content. Temporary/demo sessions remain memory-only and are never recorded. `persistTabs` writes the cache only when metadata changes, not on every activity snapshot; selection and label refresh do not advance it.

Confirmed deletion removes cache entries in the mounted frontend and Rust's `deleted_state_updates`, including closed-project caches. Failed/unknown outcomes retain entries. Initial restoration also prunes cached success tombstones. Existing layout/cache recency wins over older historical metadata; opening history may discover newer real user-message time, but does not stamp use as now. Missing selection defaults to the most recent entry. External state broadcasts do not reorder an already-mounted window.

Attention reasons, ordering and selected-row retention are in-memory for the current window lifetime. They are not persisted or reconstructed from history on reopening. Restored inactive sessions are not attention by themselves. No history discovery, new-session launch, deletion or notifications preference changes occur when selecting a view.

## Tests and verification

The counted-filter update adds shell coverage for overlapping counts, Working/compaction settlement and selected-row retention, blank arrivals, unchanged process ownership, three-view keyboard wrapping and Unread/Working restoration without hidden launches. Existing legacy `attention` restoration fixtures verify migration. Offline WebKit covers counted accessible tab names, Working selection/settlement and blank re-entry. Existing input/failure fixtures continue to cover Unread's broader attention semantics. A dedicated shell regression covers reported running/queued subagents, free-form status exclusion, input-waiting exclusion/resolution and unavailable/disconnected removal.

Counted-filter verification in `.worktrees/sidebar-filters`: `mise run check` passes 345 TypeScript/Node tests, formatting/Clippy and 76 default Rust tests (two opt-in Pi smokes ignored); the signed worktree build and all 31 offline WebKit tests pass. Native visual/focus and Linux/possible Windows acceptance remain separate. No user app/window, sessions, Pi/models, OS notifications or upstream extension were touched.

- `test/session.test.ts`: prompt acceptance hook fires for acknowledged ordinary/steering/follow-up sends, never inline/dialog renames (including canceled/rejected/unknown outcomes), compaction or uncertain prompts; accepted rename still updates name and composer receipt.
- `test/session-sidebar.test.ts`: identity cache persistence/replacement/cleanup, relative/date thresholds and malformed/future values, indicator precedence, minute/visibility/focus timer cadence and disposal.
- Rust `sessions.rs`: exact-file/catalog parity, numeric/RFC3339 timestamp validation, ignored metadata/assistant/tool/compaction records and mtime independence; `session_deletion.rs`: confirmed-only closed-project cache pruning.
- `test/session-recency.test.ts`: timestamp validation, stable ties, immutable sorting, monotonic ordering, moved-row exclusion, zoom-aware anchoring and explicit reveal.
- `test/shell.test.ts`: creation-time sorted insertion, minute refresh without IPC/state/order/focus/draft changes, historical Resume positioning, Close/Resume cache retention and confirmed-only cleanup, legacy metadata seeding distinct from RPC history, persisted All recency, no current-time refresh on selection/restore/rename, and accepted/rejected/unknown background submissions; existing selection/lifecycle tests identify sessions by mounted identity rather than sidebar indices.
- `test/browser/sidebar-recency.spec.ts`: fake-clock minute refresh preserving sidebar/transcript reading, draft/focus/order and process ownership; indicator shapes/spinner/reduced-motion checks; 15 independent offline children at 125% CSS zoom, delayed acknowledgement with streaming/completion delivered first, unchanged visible anchor/draft/focus/conversation after MRU reorder, row clicks and accepted renames preserving the complete order/viewport, acknowledged prompts (not selection/rename) moving rows, and return-to-All reveal.
- `test/session-attention.test.ts`: arrival order, repeated updates, selected resolved retention, unresolved membership, close/removal, returned-array isolation.
- `test/shell.test.ts`: real shell/mocked IPC covers filtering, live completion, final failure/disconnect and input resolution, counts, full open-session palette, per-project view restore, history exclusion, keyboard order, unchanged child ownership, singular/plural working counts, stable pulse nodes, authoritative busy/compaction settlement, blank/inert conversations, restored attention views without hidden startup, action/Close suppression, hidden-session notification eligibility, and automatic Close replacement without switching views, plus successful deletion's explicit All fallback.
- `test/browser/workspace-tabs.spec.ts`: offline WebKit children cover arrival order, retained read row/count, view switching and user-driven All recency, hidden-session navigation switching to All, blank conversation surfaces, mounted draft/disclosure/reader-position restoration, independent live processes, empty working/idle transitions, real CSS pulse/reduced-motion behavior and existing layout/focus regressions.

Latest historical-recency/time-label verification (isolated worktree at `26e551e`): `mise run check` passed 338 TypeScript/Node tests, formatting/Clippy and 76 default Rust tests (two opt-in Pi smokes ignored); `mise run build` packaged/verified the worktree macOS app and all 28 offline WebKit tests passed. No main-checkout bundle change, manual app testing, real user-session deletion or live Pi/model request. Native/platform acceptance remains separate.

Integration verification after rebasing onto `f149f66` in `.worktrees/sidebar-recency-time`: check passed 340 TypeScript/Node tests and 76 default Rust tests (two opt-in smokes ignored), formatting/Clippy, signed worktree build, and all 29 offline WebKit tests. Moving the worktree invalidated cached absolute Tauri permission paths; rebuilding only its generated Cargo target fixed this. No main bundle, user app/session, global cache or unrelated worktree changes.

Earlier prompt-only recency/rename-exclusion verification: `mise run check` passed 294 TypeScript/Node tests, formatting/Clippy and 70 default Rust tests (two opt-in Pi smokes ignored); the macOS build/signature verification and all 20 offline WebKit tests passed. These are combined-checkout totals, with no Rust, Pi or installed-extension edits for this correction. Browser output was isolated under `/tmp`. Native visual/scroll/focus and Linux/Windows acceptance remain unperformed.

Latest blank-surface verification: `mise run check` passed 279 TypeScript/Node tests, formatting/Clippy and 69 default Rust tests (two opt-in Pi smokes ignored); the packaged macOS build and 18 offline WebKit tests passed. An intermediate check encountered concurrent Rust formatting edits; the final rerun passed. No Rust changes were made for the blank-surface feature.

Run `mise run check`, `mise run build`, and offline `npm run test:browser` for sidebar geometry/focus changes. No real user sessions or OS notifications are used in fixtures. Native Tauri and Linux/Windows acceptance remain separate; ask the user to validate the visual feel in the packaged app.
