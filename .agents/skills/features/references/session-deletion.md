# Session deletion: implementation reference

**Status: Pi tree deletion and Copilot SDK deletion implemented; latest fixtures unrun. Copilot-specific ACP deletion removed.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#session-deletion) retain prior execution records.

Read the [user guide](../../../../docs/sessions.md#delete-session-tree),
[shared vocabulary](../../nimrod-ui-vocabulary/SKILL.md) and
[project/session reference](projects-and-sessions.md). Pi owns the JSONL format
and conversation writes; Nimrod owns permanent file deletion. No Pi worker,
installed extension, runtime executable or chat command participates in deletion.

## Consumer interface and Copilot deletion

New built-in Copilot uses `src/copilot/session-deletion.ts`, the existing shared
coordinator and supported SDK `client.deleteSession(id)`. It requires review,
fresh exact project membership, owned-writer exit and authoritative success.
Unknown results retain SDK identity/draft; no retries or private-directory
removal. Old draft files from the removed integration are never purged by SDK
cleanup. [SDK deletion](copilot-sdk.md#close-and-delete) owns concrete semantics.

`src/session-deletion-operation.ts` owns the consumer-oriented `SessionDeletionOperation`, `SessionDeletionSource` and source-scoped `SessionDeletionContext` interfaces. The named consumers are the Session sidebar native row menus, Project bar trash control, selected-session palette/shortcut and repeated Delete sessions picker. A source binds a saved reference/title to an operation, returning `undefined` only for identities it does not own. Operations supply a cleanup target (`key`, `draftScope`), integration-specific `label`/`detail`, live `supported` and `available()` projections, an optional `unavailableReason`, and reviewed execution. An owned but unsupported identity can still explain its disabled controls; Delete discovery includes only supported operations. Completion also includes cancellation or a reported failure; only authoritative tombstones prove removal. This port is separate from `SessionLifecycle`: persistence, connectivity, discovery, Restart and deletion are independent capabilities.

- `src/session-deletion-coordinator.ts::SessionDeletionCoordinator` registers sources, serializes local deletion, incorporates integration-owned external pending state, revalidates generic window/mounted-session gates, and owns one confirmed-success ledger. Its scoped context owns dialog presentation/progress, review ownership, mounted participant locks/observed stop, project-lifetime cancellation and application error routing. A Pi release/snapshot cannot dismiss another source's review. Locks are captured once per target, and all owned stops settle before failure releases them. Authoritative success effects deduplicate batches before the shared reconciliation callback; recovery explicitly retires a tombstone. Resolving `run()` is not an acknowledgement of successful deletion.
- `src/pi/session-deletion.ts::piSessionDeletion` constructs/adapts the existing `SessionDeletion` native transaction. It maps native files to cleanup targets and routes review/progress/errors and confirmed event/IPC/snapshot successes through its scoped context. The transaction retains ordered event processing, native writer coordination, partial results, persisted quarantine and recovery. Its native tombstone deduplication remains integration bookkeeping, not a separate UI deletion ledger.
- `src/copilot/session-deletion.ts::copilotSessionDeletion` supplies capability/readiness information, review content and the concrete validate/stop/delete sequence through the same context. It owns no separate UI pending flag, modal cleanup, participants or tombstone store. It depends on a narrow `CopilotDeletionHistory` port, not a conversation controller. `CopilotSessionHistory` implements that port through the project-owned discovery connection; no conversation is created/loaded or prompted to delete closed history. Request-owned disconnect errors are reported by the deletion operation, not duplicated as discovery errors.
- `main.ts` registers integrations and supplies one lifecycle-keyed participant adapter and one target-based cleanup callback. The latter disposes all confirmed-deleted mounted rows before choosing a replacement once, deletes exact draft scopes, retires matching recency/legacy last-session references, and updates layout/pop-outs. Delete controls, picker IDs/filtering/pruning and stale saved-history checks consume the coordinator; there is no Pi/Copilot pending OR or separate Copilot cleanup function. Pi-specific native event/recovery gates remain concrete. Adding deletion for an otherwise integrated harness requires a source implementation and registration, not another UI branch; its saved identity/layout/draft encoding remains a separate concrete persistence responsibility.

Copilot deletion requires a ready SDK history connection and a durable SDK identity.
Generic ACP sessions expose no deletion operation. Review locks only the target
without activating it or stopping work; Cancel unlocks with no lifecycle/navigation
effects. Confirmation retains/disables the dialog through fresh exact-project
membership validation, observed owned conversation stop and SDK deletion. Discovery
checks membership again immediately before `client.deleteSession(id)`. This is one
session plus SDK-owned artifacts, never a Pi descendants tree or private-file removal.

Only confirmed success removes the exact sidebar/layout/draft scope and references
through shared reconciliation. Background removal leaves selection unchanged;
removing the last row creates nothing. No prompts, Send recency, notifications,
automatic retry or reconnect. Unknown/failed removal retains local identity/draft
and reports through the deletion operation. Refresh verifies history before another
explicit attempt; missing history never falls back to creating a session.

Delete sessions aggregates Pi/Copilot with the same incremental isolation and
cancellation as Resume. Accepting a review retires unfinished listing to preserve
survivor DOM/query/highlight during execution; Refresh explicitly finishes discovery.
Readiness/history publication refreshes controls, not content-stream events.

Updated `test/session-deletion-operation.test.ts` uses the narrow SDK deletion port
for shared coordinator ordering, locks, cancellation, stop/failure/uncertainty,
disposal, external pending state, scoped review ownership and success deduplication.
Shell fixtures port closed/open deletion, retained modal/picker and draft cleanup
to SDK. Existing Pi/native transaction fixtures remain unchanged apart from SDK
identity data in mixed-layout cleanup. These fixtures are unrun; no installed-agent
deletion, native acceptance or user-session mutation was performed.

## Pi tree specification and acceptance criteria

Review a live descendants tree without launching Pi or activating the target, including working sessions. One confirmation authorizes stopping affected Nimrod-owned writers and deleting the root's current descendants, including those created during review/shutdown, without re-review. The initiating modal remains open through shutdown, removal and frontend reconciliation. Only confirmed successes clean state; unknown/partial outcomes require explicit guarded recovery.

## Code map

| File | Role |
| --- | --- |
| `index.html`, `src/theme.css`, `src/workspace.css` | Trash icons, themed loading and scrollable nested-tree review |
| `src/deletion-review.ts` | Safe iterative tree rendering, loading/cancellation, focus/IME guards, retained modal and disabled actions during execution, stopping/deleting progress |
| `src/main.ts` | Saved-row eligibility, window-targeted event subscription, reports, renderer locks, reconciliation and recovery |
| `src/session-deletion.ts` | Ordered frontend events, synchronous ownership acknowledgement without Pi RPC, progress, partial-result reconciliation and quarantine |
| `src/session-deletion-operation.ts`, `src/session-deletion-coordinator.ts` | Shared operation/source/effect ports, pending/review/participant ownership and confirmed-success reconciliation |
| `src/pi/session-deletion.ts`, `src/copilot/session-deletion.ts` | Concrete native Pi and Copilot SDK source implementations |
| `src/pi/webview-client.ts` | Composer persistence/deletionLock handshake |
| `src/pi/session-drafts.ts` | Confirmed-success file draft cleanup and matching last-session pointer |
| `src-tauri/src/session_files.rs` | Bounded store scan, header lineage, fingerprints, revalidation and children-first unlink |
| `src-tauri/src/session_deletion.rs` | Native transaction, affected-project reports, owner-scoped review, observed writer exit and quarantine |
| `src-tauri/src/workspaces.rs` | Affected-file launch/write freeze, stale-file rejection and native owner enumeration |
| `src-tauri/src/main.rs` | IPC registration, quarantine-aware startup and owner-close/quit cancellation |

The former `delete_bridge.rs` subprocess integration and its fixture have been
removed. Do not reintroduce extension discovery or `/pi-gui-delete` dispatch.

## Repeated deletion picker

`delete-sessions` is a project action with `primary+shift+backspace`, distinct from selected-tree `delete` / `primary+backspace`. `main.ts::paletteSessions('delete')` shares Resume's saved top-level catalog, warnings, ordering, search metadata and row presentation. `deleteSavedSession` obtains the coordinator's identity-bound operation; the coordinator revalidates shell availability and any matching open row's saved ID/lifecycle eligibility, while the source retains its safety/capability checks. Closed targets never create tabs, activate or launch a conversation; concrete identity/affected-owner checks remain authoritative.

`command-palette.ts::sessions('delete')` supplies the page. Choosing a row sets `isDeleting` and retains the open picker, input/query, cached catalog, row DOM and scroll position. Read-only input, disabled Back/Refresh and duplicate activation guards last until the coordinator's operation settles. `installDeletionReview` accepts a narrow `canCover` callback from main: only this window's executing deletion picker may remain open underneath; unrelated modals still block review. Native modality gives review focus/Escape; picker key/cancel handlers also refuse higher-dialog events. Cancellation changes no rows or selection. After settlement, `sessionDeleted` reads the shared coordinator's authoritative tombstones (concrete events, IPC results, response or snapshot successes); only matching cached rows are removed, including hidden filtered successes, with survivor nodes retained and pointer indices renumbered. Selected-row success advances to the same surviving index, falling back to previous; retained roots after partial failure stay listed/selected. No catalog reload occurs except explicit Refresh. Focus returns to the picker without passing through the composer or hiding/reopening the picker. Generation/disposal guards reject stale completion updates after closure/new pages; nothing is retried or reopened. Empty lists remain open; final picker Escape restores original focus. Explicit Back goes to commands.

Regression coverage: palette tests exercise retained query/selection/focus, empty lists, action failures, stale discovery and newer-interaction/API/disposal guards; shell tests exercise correlated Cancel/Enter/Escape and repeated closed-history deletion without launches, ID forwarding and default/rebound/unbound shortcuts. Offline WebKit tests exercise native HTML dialog focus/modality, row advancement and unchanged offline sibling draft. Fixture deletion never removes user session files. Actual Tauri/native shortcut and multi-window acceptance, Linux and possible Windows verification remain pending.

## Store, lineage and file identity

The store is `PI_CODING_AGENT_SESSION_DIR`, or the agent directory's `sessions`
root. `PI_CODING_AGENT_DIR` changes the agent root. Tilde and relative environment
paths expand against home/the initiating project consistently with discovery.
The default scan covers cwd-encoded directories under the full store; custom
flat stores are supported. Exact-file sessions outside this store remain refused.
Pi runtime CLI/settings-only custom stores are not newly discovered by this work.

`session_files::discover` scans directory entries iteratively and reads the first
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

Live discovery validates headers, not transcript fingerprints. Opening for discovery permits append-driven length/mtime changes while retaining regular-file/link checks and Unix device/inode checks. Review names are best-effort over bounded snapshot bytes and complete records, falling back to shortened session IDs; affected open-session reports supply their current visible titles. A partial appended body record does not block review.

After owned writers exit and discovery stabilizes, `Tree::plan` / `session_files::preview` reads affected files fully with bounded records to validate JSONL and compute SHA-256. Identity includes length/mtime and, on Unix, device/inode/ctime; opened handle/pathname metadata must agree before/after fingerprinting. Non-Unix identity uses length/mtime plus the hash; identical-content replacements are not guaranteed to be distinguished there.

Final-plan revalidation rescans membership and compares paths, headers, identities and digests at execution start; each exact file is fingerprinted again immediately before unlink. This protects the stopped-writer removal plan, **not the earlier review**. Review-time content/name/draft changes do not abort or ask for another confirmation. Root saved ID/cwd, store/link/bounds/lineage guards remain authoritative. Malformed stopped history or late external changes can still fail removal without retry. External writers are not locked; final pathname races and late external descendants remain outside Nimrod's guarantees. Do not claim OS-wide writer detection or atomic multi-file deletion.

Removal uses `std::fs::remove_file` in deterministic children-first order, **not
OS trash**. Every planned file gets a definitive success/failure result when
execute returns normally. A failed/cancelled child propagates failure to its
ancestors, retaining them; independent sibling subtrees may still succeed.
Execute is one locally owned operation and never automatically replayed.

## Transaction and window ownership

One native transaction per app process:

1. Reserve the single native deletion transaction, broadcast begin, validate root
   header ID/cwd and discover the live tree in an awaited blocking task. Nothing is stopped.
   This reservation does not block session creation or unrelated lifecycle actions.
2. Freeze affected file attachments and mutating RPC writes; idle reads,
   unrelated writes, fresh launches and unrelated saved resumes remain operational.
   The file gate is held through reservation/spawn and new identity binding, so
   freezing the reviewed set cannot miss a concurrently attaching affected writer.
   Existing owners may refresh their unchanged identity. Starts attaching to a
   reviewed file fail; stale missing files fail even after the freeze releases.
3. Choose acknowledgement participants from registered windows whose project
   directories occur in the plan, plus native affected owners and the initiator.
   Unrelated project windows do not participate. Request frontend locks and current
   token/title/draft reports synchronously, without `get_state` or waiting for Pi.
   Busy, compaction, queues, pending submission/model operations and extension input
   do not prohibit deletion. Missing affected acknowledgement aborts after 25 seconds
   without deletion; native owned writers must still match their window/token reports.
4. Validate every affected owned writer against reports. Emit review **only to
   the initiator**, with a fresh ID and `tree: [{file,title,parent,cwd}]`. Other
   affected windows acknowledge silently; they do not show confirmation dialogs.
   Native `confirm_session_deletion` accepts one matching ID/owner only.
5. Confirmation keeps the initiating review modal open, disables both footer
   actions and Escape, and shows Stopping sessions. Request fresh ownership/lock
   reports; do not compare report/draft contents or fingerprints with review.
6. Persist quarantine **before** stopping affected tokens using observed-exit
   serialization. Rescan the root after shutdown. Newly discovered descendants
   expand the monotonically growing file gate, lock/acknowledgement participants
   and quarantine; stop their owned writers too. Repeat discovery/shutdown until
   final planning contains no unguarded files and no affected owned writer remains.
   The cumulative affected set is capped at 10,000 files with an explicit error.
   Failed stop prevents execution; unrelated children are never stopped.
7. Construct fingerprints from the current stopped tree, emit `removing` progress
   (Deleting sessions), and await native execution on a blocking task. Owner close/quit
   checks before each unlink stop further removal; already removed files are not rolled back.
8. Reconcile successes/pop-outs/bookkeeping, clear operation state and release
   the affected-file gate. Clear the deletion transaction reservation and publish
   completion atomically under the start/finish transition mutex.
   A new begin cannot overtake the old completion. Round IDs reject stale reports.

### Unrelated actions and stale history

`SessionDeletion.pending` reserves deletion itself, not all session lifecycle
operations. `locked(file)` tracks only the active reviewed set; `blocked(file)`
tracks persisted quarantine (or invalid persisted safety state for saved paths).
New/New named/Temporary session, unrelated Resume/Restart/Close and notification
navigation stay available while another window reviews or executes deletion.
Normal dialog priority still applies within the reviewing window. There is no
launch queue, implicit review cancellation or command replay.

Resume catalogs are snapshots, not leases on files. An accepted stale row reports
an error through the shared notice strip: known tombstones fail immediately,
otherwise native exact-file inspection and the final file-presence check fail
without substituting fresh history. Discovery need not be serialized with deletion.
Unrelated quarantined history may be explicitly validated/recovered during a
transaction; recovery of files in its active set remains refused. Invalid
persisted deletion state blocks saved resumes/recovery, but not fresh sessions.

#### Decisions and rationale

- **Deletion is file-scoped, not an app-wide lifecycle freeze.** Sharing a native
  host does not make unrelated conversations part of a deletion transaction.
  Fresh sessions do not attach to the reviewed history, and unrelated saved
  sessions are outside the removal plan. A review may remain open indefinitely;
  it must not disable work in other projects. The former global launch barrier
  is explicitly superseded, not a safety invariant to restore.
- **Accept stale picker rows and validate at use time.** Resume discovery is a
  snapshot; files can disappear after discovery regardless of a Nimrod-wide
  gate, including through external changes. An explicit open should error if its
  exact file is gone or invalid, not require globally fresh catalogs, freeze
  discovery/launches, silently return, or create replacement history.
- **Retain only guards that protect affected files.** Rejecting a stale picker
  row is not sufficient once an agent is already attached or concurrently
  attaching: it could write during removal or recreate deleted history. Native
  file-scoped attachment/write guards and observed affected-writer shutdown
  address that race without restricting unrelated sessions.
- **Do not queue or reinterpret user actions.** An unrelated creation/open runs
  when requested; deletion must not defer it, cancel another window's review, or
  replay it after settlement. Ordinary modal priority remains window-local.
  The single-deletion reservation serializes deletion transactions only.
- **Keep corrupt-state restrictions proportional.** Unverifiable persisted
  quarantine cannot safely authorize saved-history resume/recovery. Fresh
  sessions have no saved target to recover, so that error must not block them.

Shell tests cover another window's begin, all creation variants and naming races,
unrelated Resume/Restart/Close, immediate unrelated cleanup reconnection and
stale cached Resume rows. Coordinator tests cover file-scoped locks/recovery;
Rust ownership fixtures cover fresh/unrelated launches, affected attachment
rejection and missing-file rejection after release. Fixture coverage is not
native multi-window acceptance.

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

`createTab` exposes Delete through the OS-rendered session-row context menu, not an inline `.session-delete` button. Pin/Close retain compact sibling controls; [sidebar pinning/menu specification](sidebar-attention.md#pinning-and-native-row-menus) owns native popup routing, input, state and lifecycle. The Project bar trash control and palette/shortcut remain unchanged.

The menu captures its row's `Tab` and popup request, invokes shared `runSessionRowAction(tab, 'delete')` → `deleteSession(tab)` without `activate`, and never resumes/selects a background target. Shared `deletable`
checks saved, non-demo/non-temporary, lifecycle and deletion pending/lock/quarantine
state. Working, queued and pending-submission sessions remain eligible; starting,
closing or restarting the target does not. Native identity/ownership checks still win.

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
Populated reviews initially focus Delete; loading reviews focus Cancel and retain that focus when populated. Shared `dialog-actions.ts` provides plain labels, non-visual shortcut metadata and focus-aware shortcuts: Enter on Cancel cancels, otherwise Enter confirms only enabled Delete. Escape cancels before confirmation only. Confirmation resolves its correlated answer without closing the dialog; click/form-submit/keyboard activation share one guarded path, avoiding native `method=dialog` dismissal. Execution disables Cancel/Delete and suppresses native `cancel` events and repeated submissions. Repeated/composing/keyCode-229 Enter cannot activate either action. Enter on Cancel during loading latches cancellation just like Escape.
Native HTML focus restoration stays authoritative; replacement activation does
not focus through another modal.

## Reconciliation, storage and recovery

The local `SessionDeletion.run` keeps the executing modal open through completion events, IPC results and its final snapshot reconciliation. Terminal events in other windows close only their own non-local review. Snapshot failures still report an error and retain existing affected guards; command settlement closes the modal rather than leaving it stuck. Retained Delete sessions pickers reconcile tombstones in the caller's settlement continuation before becoming interactive. No background first-attempt retry is introduced.

The former preview fingerprint comparison and exact open-session/draft-report comparison could reject a first confirmation after ordinary streaming/title/draft changes, making a later attempt succeed. Both are deliberately removed; final stopped-plan guards remain. This is a concrete code-path correction, not a reproduction of a particular live report.

Only `deleted:true` removes mounted entries/drafts. Broadcast completion, returned
IPC results and snapshot success tombstones reconcile idempotently; do not assume
an event arrives before the command result. Batch confirmed files once, dispose
mounted views/receivers first, then choose replacement once. Never ordinary Close,
reconfirm, stop unrelated tokens or resume a soon-to-be-deleted descendant.
Removing a background subtree leaves a surviving selection unchanged. Selection
uses the shared [connected-first cleanup policy](projects-and-sessions.md#selection-after-close-or-successful-deletion): most-recently-used connected in the current view, then across All, then most-recently-used remaining in the current view, then across All. `activate` requests connection through the shared `SessionConnection` coordinator. It owns the latest deferred selection while launch eligibility is blocked. Deletion's `changed` hook only signals `selectedConnection.barriersChanged()`; it owns no pending target and does not replay navigation. The common shell eligibility adapter defers only affected-file connections until their lock clears; unrelated saved replacements reconnect immediately even while deletion remains pending. The coordinator revalidates the still-presented target. Existing exact-file, quarantine and lifecycle guards gate launch. This handles completion events, returned results, snapshots and delayed barrier release without reconnecting descendants, changing a later user selection, duplicating launches, creating sessions or replaying prompts. Background deletion does not change the surviving selection. Close and deletion share selected-session loading/reconnect; only an affected-file lock requires deferred activation. Shell fixtures cover most-recent inactive replacement resume, pending results/events, duplicates, changed selection and quarantined fallback.

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

Load guards before restoring entries. Corrupt/unreadable state fails closed for saved resumes/recovery and
requires resolving the state error/restarting; fresh sessions remain available. Settings-file errors alone do not
block startup. Guard state is separate from drafts, runtime tokens and pop-outs.
Snapshots reconcile locks and missed completion as well as guards.

## Verification and remaining acceptance

- `session_files.rs` tests use disposable directories and **actually unlink only
  generated fixtures**: cross-project lineage, children-first removal, unrelated
  retention, live appended/partial-body review, refreshed descendants/content,
  stopped-plan membership/content/identity rejection, replaced root ID rejection,
  cancellation, partial results, wrong root ID/cwd/store, malformed headers, cycles,
  symlinks and hard links.
- `session_deletion.rs` tests cover affected-window selection, busy-but-acknowledged
  writer acceptance, stale/missing ownership rejection, owner/ID single-use answers,
  quarantine/corrupt state and success cleanup.
- `workspaces.rs` tests retain affected-file attachment/write guards, fresh and
  unrelated saved launches, stale-file rejection, unrelated writes, exact-token
  stop/observed exit, expanding gates capturing newly attached descendants while
  unrelated children remain live, and failed-shutdown reservations.
- `test/shell.test.ts` tests two-window targeted review vs global completion,
  extension-free IPC arguments, row targets without selection/resume, fast-preview
  loading suppression, working/pending-send eligibility, retained executing modal,
  disabled Cancel/Escape, progress, duplicate-click guards, cancellation/failure and
  confirmed-only cleanup.
- `test/deletion-review.test.ts`, `test/session-deletion.test.ts` and
  `test/deleted-drafts.test.ts` retain safe labels/focus, local cancellation,
  partial/unknown reconciliation, pending-state guards and file-scoped cleanup.
  Keyboard tests cover Enter confirmation from Delete focus, Enter cancellation from Cancel focus, Escape from Delete focus, composing/repeated/keyCode-229 Enter suppression, and Enter/Escape during loading. Offline WebKit checks Enter yields one correlated true answer and Escape one false answer.
  A deterministic window timer in modal tests verifies the 149/150 ms boundary,
  fast ready-only opening, slow in-place replacement and timer cleanup on failure,
  cancellation, disposal and existing-modal transitions. Execution fixtures cover
  keeping the modal open, native cancel/form-submit suppression, per-operation
  reset, progress and closing only after event/IPC/snapshot reconciliation.
- Offline WebKit tests retain scroll/footer/theme/focus behavior; `sidebar-pinning.spec.ts` covers replacement Pin/Close geometry and records native popup intent/disabled deletion without rendering an OS menu. Tree geometry checks 32px even rows, 24px indentation,
  icon/name alignment and guide lines at 125% zoom, plus wrapped secondary-detail
  alignment/no horizontal overflow at a narrow viewport. Browser fixtures do not
  execute native deletion.

Run `mise run test` and affected offline WebKit regressions. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow).
No real user session deletion, live Pi/model request, installed extension change
or app launch is used for verification. Native multiple-window working-session shutdown/dialog/close
acceptance, real filesystem failure modes and Linux/Windows remain unverified;
do not infer them from mocked IPC or macOS Rust/DOM tests. Record exact results
in [verification](verification.md).
