# Session tree deletion: implementation reference

Read the [user guide](../../../../docs/workspace-sessions.md#delete-session-tree),
[shared vocabulary](../../nimrod-ui-vocabulary/SKILL.md) and
[project/session reference](projects-and-sessions.md). Pi owns the JSONL format
and conversation writes; Nimrod owns permanent file deletion. No Pi worker,
installed extension, runtime executable or chat command participates in deletion.

## Code map

| File | Role |
| --- | --- |
| `index.html`, `src/theme.css`, `src/workspace.css` | Trash icons, themed loading and scrollable nested-tree review |
| `src/deletion-review.ts` | Safe iterative tree rendering, cross-project labels, loading/cancellation latch, Cancel-first focus, Enter-confirm/Esc-cancel shortcuts and modal/IME guards |
| `src/main.ts` | Saved-row eligibility, window-targeted event subscription, reports, renderer locks, reconciliation and recovery |
| `src/session-deletion.ts` | Ordered frontend events, idle acknowledgement, partial-result reconciliation and quarantine |
| `src/pi/session.ts` | `refreshDeletionState`: fresh `get_state` and pending-operation/queue checks without model work |
| `src/pi/webview-client.ts` | Composer persistence/deletionLock handshake |
| `src/pi/session-drafts.ts` | Confirmed-success file draft cleanup and matching last-session pointer |
| `src-tauri/src/session_files.rs` | Bounded store scan, header lineage, fingerprints, revalidation and children-first unlink |
| `src-tauri/src/session_deletion.rs` | Native transaction, affected-project reports, owner-scoped review, observed writer exit and quarantine |
| `src-tauri/src/workspaces.rs` | New-launch barrier, affected-file write freeze and native owner enumeration |
| `src-tauri/src/main.rs` | IPC registration, quarantine-aware startup and owner-close/quit cancellation |

The former `delete_bridge.rs` subprocess integration and its fixture have been
removed. Do not reintroduce extension discovery or `/pi-gui-delete` dispatch.

## Store, lineage and file identity

The store is `PI_CODING_AGENT_SESSION_DIR`, or the agent directory's `sessions`
root. `PI_CODING_AGENT_DIR` changes the agent root. Tilde and relative environment
paths expand against home/the initiating project consistently with discovery.
The default scan covers cwd-encoded directories under the full store; custom
flat stores are supported. Exact-file sessions outside this store remain refused.
Pi runtime CLI/settings-only custom stores are not newly discovered by this work.

`session_files::preview` scans directory entries iteratively and reads the first
nonblank JSONL record as the Pi v1–3 session header. The selected root must match
its saved ID and initiating project. Descendants follow **file-level**
`parentSession` paths, not entry `id`/`parentId` conversation branches. Recorded
paths must be absolute and are normalized/canonicalized when available. Missing
ancestor/project directories do not prevent deleting old history. A selected
root's own parent is outside the reviewed subtree; reachable cycles fail closed.

Bounds: 100,000 directory entries per store scan, 10,000 files per subtree,
256 MiB per file, 16 MiB per JSONL record. These are explicit errors, never silent
sampling. Unreadable/invalid session headers prevent a plan because subtree
membership cannot be established; unrelated valid transcript bodies are not
parsed. Symlinks anywhere in the scanned store are refused, including directory
symlinks. Unix hard-linked session files are refused. An invalid/unreadable file
error identifies its path; there is no recursive deletion of directories or
unrestricted arbitrary-path removal.

Affected files are read fully with bounded records to validate JSONL, collect the
latest `session_info` name (falling back to a shortened session ID), and compute
SHA-256. Identity includes length/mtime and, on Unix, device/inode/ctime. The
opened handle and current pathname metadata must agree before/after reading.
Non-Unix identity currently uses length/mtime plus the content hash; replaced
identical-content files are not guaranteed to be distinguished there.

Revalidation rescans membership and compares each affected file's path, header,
identity and digest. It runs before quarantine/shutdown and again at execution
start after owned writers have exited. Each exact file is fingerprinted again
immediately before unlink. External writers are not locked; final pathname races
and late external descendants remain outside Nimrod's guarantees. Do not claim
OS-wide writer detection or atomic multi-file deletion.

Removal uses `std::fs::remove_file` in deterministic children-first order, **not
OS trash**. Every planned file gets a definitive success/failure result when
execute returns normally. A failed/cancelled child propagates failure to its
ancestors, retaining them; independent sibling subtrees may still succeed.
Execute is one locally owned operation and never automatically replayed.

## Transaction and window ownership

One native transaction per app process:

1. Acquire native/global new-launch barriers, broadcast begin, validate root
   ID/cwd and construct the preview in an awaited blocking task. Nothing is stopped.
2. Freeze affected mutating RPC writes; idle reads and unrelated writes remain
   operational. New starts/resumes stay blocked until the transaction finishes.
3. Choose acknowledgement participants from registered windows whose project
   directories occur in the plan, plus native affected owners and the initiator.
   Unrelated project windows do not participate. Request locks/fresh `get_state`,
   token/title, idleness and recoverable-draft presence. Busy includes main work,
   compaction, pending submission/operation, model changes, queues, extension input
   and documented active/queued background-agent counts. Failed refresh is busy.
   Missing affected acknowledgement aborts after 25 seconds without deletion.
4. Validate every affected owned writer against reports. Emit review **only to
   the initiator**, with a fresh ID and `tree: [{file,title,parent,cwd}]`. Other
   affected windows acknowledge silently; they do not show confirmation dialogs.
   Native `confirm_session_deletion` accepts one matching ID/owner only.
5. After confirmation, request second lock/idle reports and require unchanged
   affected session/draft reports and native ownership. Revalidate the file plan.
6. Persist quarantine **before** stopping any affected child. Stop only affected
   tokens using existing observed-exit serialization and confirm no writer remains.
   Failed stop prevents execute; unrelated children are never stopped.
7. Await native execution on a blocking task. Owner close/quit checks before each
   unlink stop further removal; already removed files are not rolled back.
8. Reconcile successes/pop-outs/bookkeeping, clear operation state and release
   host gate while the app-level transaction still blocks launches. Clear that
   flag and publish completion atomically under the start/finish transition mutex.
   A new begin cannot overtake the old completion. Round IDs reject stale reports.

### Preview locks versus execution activity

`Tab.deleting` remains the safety lock for preview, confirmation, shutdown and
removal: it makes affected composers inert and gates actions/launches, but it must
not drive the sidebar activity indicator. `Tab.deletionExecuting` is a separate,
transient presentation flag. `SessionDeletion` calls a panel's optional
`executionStarted()` only on the native `quarantine` event, after confirmation
and before writer shutdown. Until then `indicator(tab)` uses the underlying idle,
inactive or unread state; it must not show a work/deletion spinner merely because
the confirmation is open. Unlock resets the execution flag on cancellation,
completion, failure or an authoritative non-pending snapshot. Working membership
and counts continue to exclude deletion-locked sessions. No agent busy state,
recency, acknowledgement, native ownership or persistence semantics change.

Shell regressions cover connected Ready rows during lock/review, cancellation,
confirmed execution, success/failure/recovery, unaffected rows, draft/inertness
and a zero Working count. Coordinator tests cover affected-only execution hooks
and snapshot unlock. Offline WebKit restores an inactive fake saved row without
launching Pi, then injects lock/review/quarantine/completion: it verifies no CSS
spinner during review, Deleting only during execution, and the unchanged offline
sibling/draft. No native files are removed by these browser/shell fixtures.

Native owner checks remain authoritative if a frontend receives locks late.
A panic/failed task join has an uncertain outcome: quarantined entries are not
implicitly resumed or retried. There is no external worker left running after
completion. Quit marks cancellation; it does not imply rollback.

### Tauri targeted-event pitfall

`listen()` from `@tauri-apps/api/event` defaults to target **Any**, not the current
window. Tauri delivers even `emit_to(other_label, ...)` to Any-target listeners.
That caused confirmation in another project, duplicate lock delivery and a
foreign pending review blocking its serialized acknowledgement queue.

`src/main.ts` must subscribe to deletion with explicit target
`{kind:'WebviewWindow', label:getCurrentWindow().label}`. Global begin/completion
broadcasts still reach all windows; lock/check/review target only their intended
listeners. Do not replace this with a default global listener. The shell fixture
models Any semantics and tests two distinct window labels.

## Sidebar action and review UI

`createTab` mounts `.session-delete` immediately before `.session-close`, as a
sibling of the conversation-selection control, never nested. Its trusted SVG is
cloned from the Project bar and aria-hidden; label is `Delete session tree for
<name>`. Both buttons have compact equal-sized hit targets, transparent surfaces
and whole-row hover; enabled trash has a destructive hover accent. Disabled trash
stays transparent. No session-row tooltip is added.

The callback captures its row's `Tab`, calls `deleteSession(tab)` without
`activate`, and never resumes/selects a background target. Shared `deletable`
checks saved, idle, non-demo/non-temporary, lifecycle, pending/lock/quarantine
state. `submissionPending` reads live draft status: restoration converts pending
to unknown and is unsuitable for eligibility. Composer writes refresh actions on
pending-status changes before any Pi activity snapshot. Native checks still win.

`SessionDeletion.run` arms the loading review before deletion IPC, but the dialog
opens with loading only if preparation takes at least **150 ms**. Fast previews
cancel that timer and open the populated review directly, avoiding a loading/tree
flash. The themed reduced-motion-aware spinner has `role=status`; tree has
`aria-busy=true` and Delete is disabled. If loading was already shown, correlated
review replaces tree contents in place, preserving Cancel focus. Cross-project trees label each row's project;
file paths are shown additionally for duplicate names. Existing modals keep
priority. Footer buttons stay visible while only the indented tree scrolls.

Tree items use a separate `.deletion-tree-row` wrapper, not padding on the nested
`li`: a 32px minimum row with 6px/8px padding, a decorative 16px session SVG and
8px text gap. Nested lists indent 24px with theme-token guide lines that stop at
the last sibling. Root name/icon are subtly emphasized; rows are read-only, with
no selection/hover affordance or disclosure interaction. Names and path/project
details share one wrapping text column, so secondary text aligns with names,
not icons. List roles preserve Safari accessibility despite `list-style:none`;
icons are aria-hidden/unfocusable. The tree has a restrained themed inset surface.
Keep vertical padding on rows only: padding on parent `li` accumulates around
subtrees and creates uneven gaps. Long names and paths wrap without horizontal
overflow at narrow dialog widths.

Cancel/Escape during loading latches local cancellation. A late review returns
false without reopening and is acknowledged via the existing ID/owner answer;
no execute occurs. Native preview/coordination can still finish before barriers
clear. Terminal events, snapshots, disposal and command `finally` cancel the
loading timer and close remaining UI; failures before 150 ms never open a late
modal. Other-modal close events must not bypass the timer, and priority still
applies after the timer expires. Failure to read deletion state must not clear the
launch guard.

The review and palette share `.workspace-modal`: themed background/foreground,
panel border, radius, shadow, padding, backdrop and top placement. Content sizing
is separate. The capture-phase document `close` listener must ignore the review's
own close: re-showing there resets returnValue and can turn Delete into Cancel.
Cancel has initial focus; Escape cancels and Enter confirms regardless of button focus. Both shortcuts prevent native focused-button activation. Enter does nothing until a pending populated review enables Delete; repeated/composing/keyCode-229 Enter cannot confirm. Loading Escape still latches cancellation.
Native HTML focus restoration stays authoritative; replacement activation does
not focus through another modal.

## Reconciliation, storage and recovery

Only `deleted:true` removes mounted entries/drafts. Broadcast completion, returned
IPC results and snapshot success tombstones reconcile idempotently; do not assume
an event arrives before the command result. Batch confirmed files once, dispose
mounted views/receivers first, then choose replacement once. Never ordinary Close,
reconfirm, stop unrelated tokens or resume a soon-to-be-deleted descendant.
Removing a background subtree leaves a surviving selection unchanged. Selection
uses the shared [connected-first cleanup policy](projects-and-sessions.md#selection-after-close-or-successful-deletion): most-recently-used connected in the current view, then across All, then next/previous inactive fallback. Automatic replacement never reconnects or creates a session; explicit selection is required to resume an inactive fallback.

Success clears corresponding `nimrod.tabs.v1:<cwd>` layouts, `nimrod.recency.v1:<cwd>`
identity-bound timestamp entries (including closed projects), matching last-session
pointer, file-scoped drafts/recovery text/uncertainty, and saved pop-out state,
snapshots and registered native reference windows. `purgeDeletedDrafts` handles
closed-project/legacy browser libraries without rewriting unrelated/malformed
storage. Cleanup errors are visible. Ordinary source Close preserves saved
pop-outs; deletion uses `popouts::delete_sessions`. Quarantine rejects late pop-out
opens; serialized geometry/update-existing writes prevent resurrection.

Failed/missing/unknown results after shutdown begins retain inactive draft-bearing
entries as **Recovery needed**. Row selection, Retry and Restart cannot launch
them. Explicit Resume/exact-file open calls `recover_deletion_session`, validates
saved ID/cwd after the transaction finishes, removes quarantine/tombstones and
reuses the mounted conversation. Missing/replaced files remain unavailable.
No prompts, queues or uncertain submissions are replayed.

App-managed state retains existing path-only guards, so this replacement needs
no migration:

- `nimrod.deletion.quarantine.v1`: failed/uncertain scopes and confirmed scopes
  frozen before shutdown;
- `nimrod.deletion.deleted.v1`: definitive success tombstones for stale restored
  sidebar/history/draft state.

Load guards before restoring entries. Corrupt/unreadable state fails closed and
requires resolving the state error/restarting. Settings-file errors alone do not
block startup. Guard state is separate from drafts, runtime tokens and pop-outs.
Snapshots reconcile locks and missed completion as well as guards.

## Verification and remaining acceptance

- `session_files.rs` tests use disposable directories and **actually unlink only
  generated fixtures**: cross-project lineage, children-first removal, unrelated
  retention, changed membership/content/identity, cancellation, partial results,
  wrong root ID/cwd/store, malformed headers, cycles, symlinks and hard links.
- `session_deletion.rs` tests cover affected-window selection, fresh writer/idle
  reports, owner/ID single-use answers, quarantine/corrupt state and success cleanup.
- `workspaces.rs` tests retain new-launch and affected-write barriers, unrelated
  writes, exact-token stop/observed exit and failed-shutdown reservations.
- `test/shell.test.ts` tests two-window targeted review vs global completion,
  extension-free IPC arguments, row targets without selection/resume, fast-preview
  loading suppression, duplicate-click guards, cancellation/failure and confirmed-only cleanup.
- `test/deletion-review.test.ts`, `test/session-deletion.test.ts` and
  `test/deleted-drafts.test.ts` retain safe labels/focus, local cancellation,
  partial/unknown reconciliation, pending-state guards and file-scoped cleanup.
  Keyboard tests cover Enter from Cancel focus, Escape from Delete focus, composing/repeated/keyCode-229 Enter suppression, and Enter/Escape during loading. Offline WebKit checks Enter yields one correlated true answer and Escape one false answer.
  A deterministic window timer in modal tests verifies the 149/150 ms boundary,
  fast ready-only opening, slow in-place replacement and timer cleanup on failure,
  cancellation, disposal and existing-modal transitions.
- Offline WebKit tests retain scroll/footer/theme/focus behavior and sidebar trash
  geometry/eligibility. Tree geometry checks 32px even rows, 24px indentation,
  icon/name alignment and guide lines at 125% zoom, plus wrapped secondary-detail
  alignment/no horizontal overflow at a narrow viewport. Browser fixtures do not
  execute native deletion.

Run `mise run check`, `mise run build` and affected offline WebKit regressions.
No real user session deletion, live Pi/model request, installed extension change
or app launch is used for verification. Native multiple-window dialog/idle/close
acceptance, real filesystem failure modes and Linux/Windows remain unverified;
do not infer them from mocked IPC or macOS Rust/DOM tests. Record exact results
in [verification](../../../../docs/verification.md).
