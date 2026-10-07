# Session tree deletion: implementation reference

Read the [user guide](../../../../docs/workspace-sessions.md#delete-session-tree),
[shared vocabulary](../../nimrod-ui-vocabulary/SKILL.md) and
[project/session reference](projects-and-sessions.md). Pi is authoritative for
session files, subtree membership and removal. This is not a generic harness API.

## Code map

| File | Role |
| --- | --- |
| `index.html`, `src/theme.css`, `src/workspace.css` | Trash icon and custom HTML confirmation with a scrollable nested session tree |
| `src/deletion-review.ts` | Safe iterative tree rendering, Cancel-first focus, modal/IME guards, correlated review answer |
| `src/main.ts` | Button/palette eligibility, mounted session reports, renderer locks, draft/entry reconciliation, explicit recovery |
| `src/session-deletion.ts` | Ordered frontend events, lock acknowledgement, partial-result reconciliation, quarantine and pending-worker state |
| `src/pi/session.ts` | `refreshDeletionState`: fresh `get_state` plus pending-operation/queue checks without model work |
| `src/pi/webview-client.ts` | Existing deletionLock/deletionState handshake persists composer state and locks submission |
| `src/pi/session-drafts.ts` | Delete only confirmed-success file drafts; clear matching last pointer |
| `src-tauri/src/session_deletion.rs` | App-wide native transaction, all-window reports, owner-scoped custom review handshake, observed child exit, persistent quarantine/recovery |
| `src-tauri/src/delete_bridge.rs` | Dedicated Pi worker, exact command provenance, framing/correlation, preview/results validation and observed worker exit |
| `src-tauri/src/workspaces.rs` | Native new-launch barrier and affected-file write freeze; owned writer enumeration |
| `src-tauri/src/main.rs` | IPC registration, quarantine-aware start, deletion worker shutdown on quit, owner-close cancellation |

## Installed integration and scope

Use `~/.pi/agent/extensions/delete-session-tree.ts`, or the equivalent beneath
`PI_CODING_AGENT_DIR`. Resolve the canonical file path; do not bundle, update,
copy over or change the installed extension or sibling Pi GUI without separate
permission. The existing extension already supports the private Pi GUI v1 bridge.

Store is the agent directory's `sessions` root, or the flat
`PI_CODING_AGENT_SESSION_DIR` override. Expand tilde/relative overrides against the
selected project consistently with existing discovery. The full store root, not
only the cwd-encoded project directory, permits cross-project descendants.
Exact-file sessions outside that store fail preview; there is no broader scan or
filesystem fallback. Canonical file identity is used for owned writers and reports.
Hard-link aliases and external writers are outside Nimrod's guarantees.

Direct RPC `/delete` is deliberately refused by the extension. Do not submit
`/delete current` to a conversation or implement native `remove_file` fallback.
The UI action targets the selected saved session as the subtree root; it is not
historical-session picking or within-file conversation-branch deletion.

## Worker and bridge v1

Launch using saved Runtime Pi/Node paths, adding Node's directory to PATH as for
normal launch. Flags:

```text
--mode rpc --offline --no-session --no-extensions --no-skills
--no-prompt-templates --no-themes --no-context-files --no-tools
--extension <canonical installed extension> --pi-gui-delete-bridge
```

This is a separate native-owned ProcessHost, never an open conversation. Check
`get_commands` for `pi-gui-delete`, `source: extension`, and the exact canonical
extension source. Accept `sourceInfo.path` or the older `path` property. Check
`get_state` for an unpersisted idle worker. Without verification, never send a
prompt that might fall through to model work. Fail on unexpected agent/message/tool
start events. Existing ProcessHost provides bounded LF-only JSON framing, pipe
shutdown and escalation; no additional Node backend is introduced.

Verified commands are RPC `prompt` records whose messages are:

```text
/pi-gui-delete {"id":"uuid","action":"preview","directory":"/store","cwd":"/project","root":"/store/root.jsonl"}
/pi-gui-delete {"id":"uuid","action":"execute","token":"preview-token"}
```

Completion requires `extension_ui_request`, `method: setStatus`,
`statusKey: pi-gui-delete-v1`, with JSON `statusText` containing matching `id`,
`version: 1`, `ok: true`. Generic prompt acceptance is NOT deletion success.
Unrelated/stale status IDs are ignored. Preview/verification use 20-second deadlines;
execute has no normal timeout and is never replayed. Disconnects, malformed or
incomplete result sets are unknown outcomes, not successful deletion.

Preview contains `{token, root, sessions:[{file,title,cwd}]}`. Validate exact root,
absolute/store-confined paths, unique membership, nonempty token/tree and a 10,000
session bound. Native exact-file validation also checks the selected root's saved
ID before and after preview. `review_tree` enriches only that authoritative membership with read-only `parentSession` header metadata for indentation; it does not discover additional files. Header reads are bounded and disconnected/cyclic lineage fails review. Results are `{results:[{file,deleted,error?}]}` with
exactly one report per preview file. `ok:true` can contain individual failures.
The plugin owns single-use token consumption, rescanning, parent/ID/inode checks
and children-first removal; do not duplicate its lineage/deletion algorithm.

## Transaction ordering and ownership

One native transaction per app process:

1. Acquire the native new-launch barrier, broadcast begin, validate selected
   exact-file ID/cwd and start/verify the worker. Nothing is stopped during preview.
2. Freeze mutating RPC writes for preview files, leaving read-only idle checks and
   unrelated conversation writes operational. Block all new starts/resumes until
   worker shutdown is observed; this covers other windows and late IPC.
3. Ask every registered project window to acknowledge lock with affected canonical
   files, current token/title, idleness and recoverable-draft presence. Frontends
   persist/lock composers and refresh live `get_state` before reporting. Busy means
   main work/compaction, pending submission/operation, model changes, queues,
   extension input or documented active/queued background-agent counts. A failed
   refresh reports busy. Missing readiness/acknowledgement aborts after 25 seconds.
4. Cross-check every native owned affected writer against the reports. Emit a `review` event only to the initiating project, with a fresh review ID and `tree: [{file,title,parent}]`. The custom HTML dialog shows names in an indented, scrollable tree, one short discard sentence, Cancel and Delete N sessions. Paths appear only for duplicate-name disambiguation. Cancel has initial focus; Escape cancels and repeated/composing Enter cannot confirm. Existing modals keep priority. `confirm_session_deletion` accepts exactly one matching ID from that native owner window; other windows/stale IDs are rejected. Cancellation unlocks and preserves conversations/drafts/processes.
5. Request a second lock/idle report after confirmation, recheck native ownership
   and require unchanged affected reports (including draft disclosure). New/changed
   affected entries, busy work or owner close/quit abort before removal.
6. Persist quarantine BEFORE any owned writer stop or execute. Stop affected tokens
   across windows using existing observed-exit lifecycle serialization. Confirm no
   affected writer remains; stop failure prevents execute. Unrelated children are
   never stopped. No OS-wide process search or claim of excluding external writers.
7. Execute the extension token once. Always stop and observe the separate worker
   afterward. A cached stop result preserves failure rather than treating an empty
   supervisor slot as success. Unobserved worker exit retains the global barrier.
8. Clear operation state and release the host gate while the app-level transaction
   flag still blocks launches. Clear that flag and publish completion together under
   a synchronous start/finish mutex, so snapshots after completion cannot retain a
   stale launch lock and a new begin cannot overtake old completion. Correlated
   round IDs reject stale window acknowledgements.

The owner closing or quitting cancels pending review. Once execute is sent, its
outcome may be partial/unknown; do not reinterpret cancellation as rollback. Quit
stops the worker through the normal native lifecycle. Window retirement and
all-window acknowledgement boundaries still need native acceptance.

## UI reconciliation and persistence

Only `deleted:true` results remove mounted entries and their drafts. `SessionDeletion` reconciles broadcast events, returned command results and definitive success snapshot tombstones idempotently. Do not ignore the command result and assume a separate event arrives first: that race left successful deletions in the sidebar. `deleted(files)` batches all confirmed files, disposes their mounted views/receivers first, then chooses a replacement once. Do not call ordinary Close, reconfirm or stop unrelated tokens. Clear confirmed-success entries from saved
`nimrod.tabs.v1:<cwd>` layouts and `nimrod.last-session.v1`, including closed-window
bookkeeping. Mounted draft libraries discard successful file scopes; `purgeDeletedDrafts` also removes only matching file keys/last pointers from project and legacy browser libraries, including closed-project drafts, without rewriting unrelated keys or malformed storage. Browser-storage errors are reported. Failed scopes retain drafts/recovered text/uncertain submissions.

Replacement selection follows the displayed sidebar order: next surviving row below the removed selection, then previous. In Needs attention, if no candidate remains, keep that view and leave the conversation blank; a surviving session in original open order may be remembered for returning to All but must not be shown or resumed. If no sessions remain, All shows the empty project while Needs attention stays blank; never create a new session. See [sidebar visibility](sidebar-attention.md#conversation-visibility-and-blank-surface). Removing a background subtree does not replace a surviving selection. Never select per descendant, accidentally resume a soon-to-be-deleted child, or navigate while a modal owns focus.

Successful deletion removes saved pop-out state references, snapshot files and registered native reference windows through `popouts::delete_sessions`, including closed-project references. It is not ordinary source Close (which preserves saved pop-outs). The operations mutex and update-existing geometry writer prevent late resurrection; late opens of quarantined sources are rejected. Cleanup failures are explicit even when Pi file deletion succeeded.

After shutdown begins, failed/missing/unknown per-file results retain inactive,
draft-bearing sessions. They show Recovery needed and cannot automatically launch
on row selection, Retry or Restart. Explicit Resume/exact-file open calls native
`recover_deletion_session`, checks existing file ID and project cwd after worker
exit, removes its quarantine and then reuses the existing mounted conversation.
No prompts/queues are replayed. Missing/replaced files remain unavailable.

Quarantine/tombstones are stored in app-managed state:

```text
"nimrod.deletion.quarantine.v1": ["/canonical/session.jsonl", ...]
```

Load before restoring sidebar entries. A separate `nimrod.deletion.deleted.v1` path-only success tombstone index appears as `deleted` in snapshots, removes stale restored rows/drafts, and filters stale picker results. These minimal guards contain no conversation/draft/reference content. Explicit validated recovery removes both guards if the same file identity was restored; partial/unknown outcomes are never mistaken for successes. Malformed guards or an unreadable state file fail closed and
require resolving the state error/restarting the app. Settings-file errors alone
must not disable normal session startup. Quarantine is independent of draft
storage, runtime tokens and pop-out snapshots.

Frontend snapshots reconcile locks as well as pending/quarantined state, covering
missed completion events. Event handling is serialized; old/disposed renderers
must not delete panels or replay work. Native mutating writes remain authoritative
if a frontend is late to receive a lock. Keep Close and Restart distinction intact.
Nimrod cleans its saved references separately from Pi's session-file plugin; the plugin is unchanged.

### Shared modal styling

The deletion review and command palette both use `.workspace-modal` in `index.html`. `src/workspace.css` owns their shared themed surface: editor-widget background, foreground, 1px panel border, 10px radius, widget shadow, 12px padding, backdrop and top-of-window placement. Keep that base shared rather than letting a new dialog fall back to the browser's default light surface. Deletion's title matches the palette's 13px heading and its form uses the same 10px spacing rhythm; normal button geometry remains inherited, with the Delete action retaining its destructive accent.

Content sizing is separate: deletion uses a narrower width, a bounded flex form and an independently scrolling tree, with footer actions outside the scroll pane. Tests compare computed surface/heading styles to the palette in default, Dracula and system-light themes, and ensure the footer remains inside the dialog after scrolling. Styling does not alter confirmation, cancellation, ownership or reconciliation behavior.

### Immediate loading review

`SessionDeletion.run` calls `loadingReview` synchronously before invoking native deletion IPC, so worker startup, preview and idle acknowledgements happen behind an already-open dialog. `installDeletionReview.loading` shows a themed, reduced-motion-aware spinner with `role=status`, `aria-busy=true` on the tree and Delete disabled. The correlated review replaces only the tree contents, preserving the modal and Cancel focus. Existing modals still keep priority.

Cancel/Escape while loading latches cancellation locally. A late review returns `false` without reopening and is acknowledged through the existing owner/ID-scoped native confirmation; no execute is sent. This dismisses the UI, not the in-flight native preview worker: native shutdown/barrier cleanup remains authoritative. Terminal events, snapshots, disposal and the command's `finally` close any remaining loading dialog, including preview failure or failed shutdown-state verification. The latter must not clear the native launch guard. A later eligible deletion resets the loading state.

Unit coverage in `test/deletion-review.test.ts` exercises immediate loading, disabled confirmation, safe cancellation, late review suppression, in-place replacement and queued-modal cleanup. `test/shell.test.ts` holds preview pending to assert the button opens the dialog synchronously; `test/session-deletion.test.ts` checks loading-before-IPC and cleanup on preview/snapshot failure. These fixtures do not execute the installed extension or establish native acceptance.

### Dialog focus pitfall

The review waits behind an existing modal using a document capture-phase `close` listener. Ignore the review dialog's own close in that listener: re-showing it before its target close handler runs resets `returnValue`, turns Delete into Cancel, and can leave the modal open. Existing native HTML focus restoration remains authoritative; batch activation focuses only the selected surviving pane when no dialog is open.

## Tests and native acceptance

- `test/session-deletion.test.ts`: affected-only locks, fresh idle/draft reports,
  busy/unresponsive descendants, cancellation, partial successes, unknown outcomes,
  observed-worker barrier, restored quarantine, explicit recovery and disposal.
- `test/shell.test.ts`: disabled temp/new-session icon, selected saved-file native
  dispatch, no chat prompt, confirmed-only row/draft cleanup, plugin failure,
  cancellation and explicit recovery before restored-session launch.
- Rust `delete_bridge.rs`: real subprocess with `test/fixtures/delete-bridge.mjs`,
  never Pi or the installed extension. Provenance/unpersisted checks before any
  prompt; LF/Unicode correlation; acknowledgement versus status completion;
  single-use tokens; changed/incomplete/disconnected results; no host filesystem
  removal. Fixture session files remain present even after simulated success.
- Rust `session_deletion.rs`: cross-window writer/idle checks, confirmation draft
  disclosure, partial bookkeeping cleanup, persistent/corrupt quarantine and paths.
- Rust `workspaces.rs`: no new launch during deletion, affected-only mutating write
  freeze, read-only checks/unrelated writes, token-scoped observed shutdown and
  barrier release. Existing ownership/shutdown-failure fixtures remain authoritative.
- `test/deletion-review.test.ts` and offline `test/browser/deletion-review.spec.ts`: actual nested HTML modal, scroll bounds, safe labels, Cancel-first/Escape behavior, one correlated answer, unchanged background drafts/processes. Browser reviews are injected fixtures and do not execute deletion.
- `test/deleted-drafts.test.ts`: file-scoped cleanup across closed libraries, unrelated/failed scopes retained.
- Offline WebKit also checks the disabled demo trash icon, keyboard palette and existing
  scroll/session/focus regressions. No real user deletion, installed-plugin execution,
  live Pi prompt or paid model request is used for tests.

Run `mise run check`, `mise run build`, and affected offline browser regressions.
Native custom-dialog focus, multiple real project windows, actual installed
plugin execution, partial filesystem failures and cross-platform behavior remain
for authorized native acceptance. Do not claim those from mocked IPC or subprocess
protocol fixtures. Record exact evidence in [verification](../../../../docs/verification.md). Latest combined checkout: 279 TypeScript/Node tests, 69 default Rust tests (two opt-in Pi smokes ignored), formatting/Clippy, macOS packaging and 18 offline WebKit tests passed. Actual user-file deletion and installed-plugin execution were not used for verification.
