# Session sidebar views: implementation reference

Read the [human guide](../../../../docs/workspace-sessions.md#sidebar-views) and
[UI vocabulary](../../nimrod-ui-vocabulary/SKILL.md). Paths below are repository-root relative.

## Code map

- `index.html`: All / Needs attention tablist, shared tabpanel, outstanding count and empty-state status with stable text/ellipsis nodes.
- `src/workspace.css`: compact view tabs, theme-token colors; existing session rows and conversation geometry remain intact.
- `src/session-attention.ts`: pure window-local inbox ordering and selected-row retention.
- `src/session-recency.ts`: timestamp validation/monotonic use ordering, stable All sort, zoom-aware viewport anchoring and explicit row reveal.
- `src/main.ts`: attention reasons, view persistence, minimal row moves/visibility, focus and keyboard navigation.
- `src/pi/session.ts`: existing Pi attention callback for live settled completion, final run/process failures; input dialog lifetime is tracked by the shell's `withTabDialog`.

Per-row trash/Close controls are siblings of the conversation-selection button in both views. Trash targets that row without changing selection or recency; see [session deletion](session-deletion.md#sidebar-row-action) for eligibility, confirmation and cleanup.

## Membership and resolution

`needsAttention(tab)` is inputCount > 0, unread completion, or a failure flag.

- Completion comes only from the existing Pi `attention('completed')` callback: live `agent_start` followed by idle `agent_settled`. Another presented session, Needs attention hiding the remembered session, or Settings covering the conversation makes completion unread. History, ordinary snapshots, `agent_end`, intermediate retry errors and tool output do not create unread work.
- Visiting clears unread completion. It does not answer a dialog or clear a failure.
- `inputCount` tracks outstanding shell-mediated Pi input/select/confirm dialogs (including a Pi `/name` input), until their promise resolves/cancels. Pending dialogs retain their existing global modality and originating session identity. The palette's local name/model steps are not outstanding Pi dialogs.
- Final run/process failures use existing `attention('failed')`. Startup/resume/stop/restart notices also flag the session through `showNotice`. Generic extension notifications and isolated tool errors are not failures.
- A new non-compacting, available busy run clears a prior failure. Explicit relaunch clears it at its start; a failed launch/stop restores it. Merely reading never clears it. There is no manual dismiss in this first pass.
- Desktop notification settings/focus suppression do not govern sidebar membership. No new OS alerts are emitted by the sidebar itself.
- Existing token, close/restart and unload guards remain authoritative; do not derive failure from arbitrary status strings or infer semantics from historical messages.

## Stable ordering and selection

`SessionAttention.reconcile` retains the current inbox order, removes closed/resolved unselected sessions, and appends new attention arrivals. Order is independent of the `tabs` array and repeated activity. No timestamps or recency sort.

A resolved row already in the inbox remains while selected. The count measures actual outstanding attention, so a retained read row may coexist with count 0. It disappears after selecting another session. Unresolved input/failure remains regardless of selection. Explicitly selecting a non-attention session through the palette/shortcuts switches to All before showing its conversation. New/resumed sessions follow the same rule. It never inserts an ordinary session into the inbox.

All sorts a copy of `tabs` by descending `lastUsed`; the underlying open order remains unchanged for stable ties, Switch session and cycling. `touchTab` runs only for `PiSession`'s `SessionUi.promptAccepted` callback after a successful `prompt` RPC (ordinary message, steering or follow-up). It is deliberately not a generic composer-receipt callback: `/name` returns its accepted receipt after `set_session_name` but exits without invoking this hook. Renaming and other metadata/control RPCs, including compaction, never update recency. `activate` selects/reveals but never touches recency: row clicks, Switch session, cycling, New/Resume, reading, compaction, history, snapshots, tool output/completions, draft typing, restore/startup and automatic Close/deletion selection do not count. Selection previously updated recency too; this was corrected after user feedback. Do not reconnect `touchTab` to navigation. The timestamp advances monotonically across same-millisecond uses or clock rollback; malformed/absent stored values become zero. Nothing is inferred from Pi file mtime or history, and unknown/rejected/canceled submissions never count. Switch session and Cmd/Ctrl+Shift+[ / ] always cover every open session, independent of the filter. Sidebar Up/Down/Home/End traverse only visible rows in displayed order. The view tablist supports Left/Right/Home/End and standard Enter/Space button activation.

`renderSidebar` hides row wrappers and moves only out-of-order existing nodes; never rebuild rows or transcripts, dispose renderers, start/stop children, clear drafts, or focus the composer in response to a filter change. It uses `captureSidebarScroll` to preserve the first surviving visible row at the same pixel offset, not merely preserve scrollTop. The deliberately moved row is excluded so an acknowledged send never chases it to the top. Row clicks do not move rows at all. Fallback is the previous scrollTop if no visible anchor survives. Rect deltas are normalized to layout pixels for native and fixture CSS zoom; `overflow-anchor:none` avoids competing browser anchoring. Focus on a DOM-moved row is restored with preventScroll, without changing the focused element. `revealSidebarRow` changes only sidebar scrollTop for explicit palette/shortcut/New/Resume navigation or returning to All. Sidebar row clicks disable that reveal; restoration and automatic replacement also disable it. Focus on a filtered-away row/Close falls back to the selected view tab, unless a dialog owns focus. Browser scroll clamping when content becomes shorter is unavoidable.

## Conversation visibility and blank surface

`active` remembers the navigation target for returning to All and cycling;
`presented` identifies the conversation actually visible. `sidebarTabs` retains
resolved rows only for `presented`, not a hidden remembered selection.
`presentConversation` owns renderer activation, mounted root visibility/inertness,
current-row markers, mode badge, action eligibility and pop-out selection.
Restore parent/root visibility before activating the renderer so scroll geometry
is measured in the shown pane.

- A shown conversation must have a selected row in the current sidebar view.
  Entering Needs attention from a working/idle session without attention hides
  the entire conversation area, including transcript, status and composer. Do
  not automatically select another attention row. This also applies when the
  inbox contains other rows but none is selected.
- An empty Needs attention view has no conversation, empty-project buttons or
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
- A completed row explicitly visited in Needs attention stays selected after its
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

## Empty-view working status

When Needs attention has no visible rows, `renderSidebar` counts live, available Pi sessions whose authoritative state is busy (including compaction). Starting/closing/restarting, ended/unavailable and input-waiting sessions are excluded. Display `1 session working…` or `N sessions working…`; only a zero count displays `No sessions need attention.`. All's empty message remains `No open sessions.`. A retained selected row still suppresses the empty status.

The count is informational: it does not add working sessions to the inbox or change the attention badge. `agent_end` and compaction completion do not independently clear busy state; wait for Pi's reducer/snapshots to do so. No polling, native focus lookup or new harness requests.

Keep the status text and ellipsis nodes mounted, updating text only on actual count/state transitions so snapshots do not reset the CSS animation or repeatedly announce unchanged live-region text. Ellipsis is aria-hidden, pulses opacity without changing geometry, and stops animating under `prefers-reduced-motion: reduce`.

## Storage and boundaries

Sidebar width is independent of these views and recency; see [sidebar resizing](sidebar-resize.md) for its project-scoped app-state key, edge handle, zoom normalization and responsive caps.

App-managed state key: `nimrod.sidebar.view:<canonical cwd>` contains `all` or `attention`. Missing/invalid values default All. It uses the existing Preferences state writer, not user settings or Pi session files. Each mounted window retains its chosen view; external state updates do not rebuild it.

All recency is saved as an additive `lastUsed` field on entries in the existing app-state `nimrod.tabs.v1:<canonical cwd>` layout. `persistTabs` still serializes in open order and excludes temporary/demo entries; first-save identity promotion carries the mounted entry's timestamp into its canonical-file layout. Older layouts need no migration and preserve tie/open order until an acknowledged send. New entries start at zero and join these stable ties after sessions with recorded sends. Previously persisted timestamps (including ones produced by the superseded selection-driven behavior) are retained; do not rewrite them or infer acceptance from historical messages. Restoring the remembered selection does not refresh its timestamp; a missing selection defaults to the most recent entry. Closed sessions aren't kept as a separate recency history; reopening one starts with zero recency until its next acknowledged send. Deletion removes the entire layout entry, including recency; partial failures retain it. External app-state changes do not reorder an already-mounted window.

Attention reasons, ordering and selected-row retention are in-memory for the current window lifetime. They are not persisted or reconstructed from history on reopening. Restored inactive sessions are not attention by themselves. No history discovery, new-session launch, deletion or notifications preference changes occur when selecting a view.

## Tests and verification

- `test/session.test.ts`: prompt acceptance hook fires for acknowledged ordinary/steering/follow-up sends, never inline/dialog renames (including canceled/rejected/unknown outcomes), compaction or uncertain prompts; accepted rename still updates name and composer receipt.
- `test/session-recency.test.ts`: timestamp validation, stable ties, immutable sorting, monotonic ordering, moved-row exclusion, zoom-aware anchoring and explicit reveal.
- `test/shell.test.ts`: persisted All recency and legacy layouts, no timestamp refresh on restore, row/palette/cycling selection or acknowledged rename, accepted/rejected/unknown background submissions and no inference from snapshots/history; existing selection/lifecycle tests identify sessions by mounted identity rather than sidebar indices.
- `test/browser/sidebar-recency.spec.ts`: 15 independent offline children at 125% CSS zoom, delayed acknowledgement with streaming/completion delivered first, unchanged visible anchor/draft/focus/conversation after MRU reorder, row clicks and accepted renames preserving the complete order/viewport, acknowledged prompts (not selection/rename) moving rows, and return-to-All reveal.
- `test/session-attention.test.ts`: arrival order, repeated updates, selected resolved retention, unresolved membership, close/removal, returned-array isolation.
- `test/shell.test.ts`: real shell/mocked IPC covers filtering, live completion, final failure/disconnect and input resolution, counts, full open-session palette, per-project view restore, history exclusion, keyboard order, unchanged child ownership, singular/plural working counts, stable pulse nodes, authoritative busy/compaction settlement, blank/inert conversations, restored attention views without hidden startup, action/Close suppression, hidden-session notification eligibility, and automatic Close replacement without switching views, plus successful deletion's explicit All fallback.
- `test/browser/workspace-tabs.spec.ts`: offline WebKit children cover arrival order, retained read row/count, view switching and user-driven All recency, hidden-session navigation switching to All, blank conversation surfaces, mounted draft/disclosure/reader-position restoration, independent live processes, empty working/idle transitions, real CSS pulse/reduced-motion behavior and existing layout/focus regressions.

Latest prompt-only recency/rename-exclusion verification: `mise run check` passed 294 TypeScript/Node tests, formatting/Clippy and 70 default Rust tests (two opt-in Pi smokes ignored); the macOS build/signature verification and all 20 offline WebKit tests passed. These are combined-checkout totals, with no Rust, Pi or installed-extension edits for this correction. Browser output was isolated under `/tmp`. Native visual/scroll/focus and Linux/Windows acceptance remain unperformed.

Latest blank-surface verification: `mise run check` passed 279 TypeScript/Node tests, formatting/Clippy and 69 default Rust tests (two opt-in Pi smokes ignored); the packaged macOS build and 18 offline WebKit tests passed. An intermediate check encountered concurrent Rust formatting edits; the final rerun passed. No Rust changes were made for the blank-surface feature.

Run `mise run check`, `mise run build`, and offline `npm run test:browser` for sidebar geometry/focus changes. No real user sessions or OS notifications are used in fixtures. Native Tauri and Linux/Windows acceptance remain separate; ask the user to validate the visual feel in the packaged app.
