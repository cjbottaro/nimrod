# Projects and sessions

## Projects

A project is a directory—no Git repository, manifest or registration required. One canonical directory belongs to each project window and is the working directory of its sessions. Its path stays visible in the **Project bar**.

- Use **File → Open project…** (**⌘/Ctrl O**), select a directory on the welcome screen, or run `nimrod /path/to/project` after installing the [terminal launcher](../README.md#terminal-launcher).
- Opening a project never starts Pi. An already-open directory focuses its existing window; another directory opens another project window. The native menu works even when a reference window is focused, and opens a project window rather than rebinding the welcome screen.
- Gitignored worktree subdirectories can live inside a project. Sessions launched in those directories currently require separate project windows; nesting alone does not group them under the parent project.

## Session management

### Open sessions

The **Session sidebar** shows a flat list of open conversations, activity and per-row trash/Close controls. **New session** starts a persistent conversation. Selecting another session leaves background agents running and retains each conversation's draft, disclosures and scroll position.

**⌘/Ctrl ⇧ P** opens the keyboard-only **Command palette**:

- **Switch session…** lists all open sessions, including those hidden by the sidebar view.
- **Resume session…** searches saved project history by name, preview or path, including closed sessions. Escape returns to commands; another Escape closes the palette and restores focus. Refresh retries history loading.
- **New named session…** collects a single-line name with an inline Create button. Enter creates; Esc cancels. Naming alone does not save empty history. The Pi runtime must support its native `--name` option.
- **New temporary session** and **New offline demo** are explicit alternatives. Temporary conversations are absent from saved history. Their drafts, recovered/uncertain submissions and pop-outs are runtime-only and are discarded on Close, window close, quit or reload; they are not available through draft recovery.
- **Open session file…** handles files outside the normal discovery directory. Files must belong to this project's exact working directory; invalid files never fall back to new sessions.
- **Recover unattached draft…** explicitly copies retained text into a new session. Nothing is submitted automatically.

Closing a session waits for its agent to stop before removing it from the sidebar. Saved-session history and drafts remain; temporary/offline-demo state is discarded entirely. Active work and temporary sessions require confirmation. Canceling Close or a failed agent shutdown keeps the session and its in-memory draft available. A closed session has no Nimrod-owned Pi process; an open session may be inactive. Reopening a project restores saved sidebar entries without starting Pi; selecting one resumes it. Closing a project window stops only its children; quitting stops all owned children. No background daemon.

Default shortcuts (customizable in [Settings → Keybindings](keybindings.md)): **⌘/Ctrl N** creates a session, **⌘ Option N / Ctrl Alt N** opens New named session, **⌘/Ctrl ⇧ N** creates a temporary session, **⌘/Ctrl T** searches open sessions, **⌘/Ctrl K** searches saved project history, **⌘/Ctrl Backspace** opens deletion review, **⌘/Ctrl M** selects a model, **⌘/Ctrl E** selects thinking level/effort, **⌘/Ctrl W** closes it, **⌘/Ctrl B** toggles the sidebar, and **⌘/Ctrl ⇧ [ / ]** switches open sessions.

### Sidebar width

Drag the sidebar's right edge to resize it. Width is remembered per project in app state, independently of All/Needs attention and whether the sidebar is hidden. A narrower window temporarily caps the width; your preferred size returns when space is available. Narrow windows retain the existing overlay sidebar.

- Focus the resize handle with Tab, then use **Left/Right** for 10px changes, **Shift+Left/Right** for 50px, or **Home/End** for the current limits.
- **Double-click** the edge to restore the default width. **Escape** cancels an unfinished drag without saving.
- Resizing keeps sessions running and retains drafts, disclosures, composer focus and transcript follow/reading intent. It does not reorder sessions.

### Sidebar views

Use **All** for every open session, most recently used first, or **Needs attention** for outstanding input requests, unread completed responses and session failures. The count shows sessions needing attention, not messages. Ordinary idle sessions, tool output and saved history do not enter this view.

- All's **last used** changes only when Pi acknowledges a message (`prompt` request), including steering and queued messages. Selecting, reading, renaming (`/name`), changing models, compaction, creating or resuming a session does not update recency. Clicking Send alone, rejected/uncertain submissions, background output and completion do not update it. Reading clears unread status, not recency.
- All's order is remembered for saved open sessions across project/app reopening. New/older entries without recency follow recently used sessions in stable open order until an acknowledged send. Restoring sessions or automatically selecting a replacement after Close/deletion does not mark them as recently used.
- Reordering preserves a visible sidebar row's position rather than jumping to the top or following the moved session. Clicking an already-visible row does not add a scroll; explicit palette/shortcut navigation and New/Resume reveal their target. Returning from Needs attention to All reveals the remembered selected session. Content shrinking can still clamp scrolling.
- With no visible attention rows, the view shows **“N sessions working…”** while agents are busy (including compaction), with gently pulsing dots. Reduced-motion preferences disable the pulse. **“No sessions need attention”** appears only when none are working.
- Needs attention arrivals append to the bottom; updates never reshuffle existing inbox rows.
- Visiting clears an unread response, but keeps that row visible while selected. It disappears when you leave, unless it still needs attention. Reading does not answer an input request or clear a failure.
- Input requests clear when answered/canceled; failures clear when new work or an explicit relaunch starts. There is no separate dismiss action yet.
- The conversation area shows only a selected session in the current view. Switching to Needs attention from a working or idle session without attention leaves it blank—even if other attention rows are available. Select a row to read it; new arrivals never open themselves.
- A blank attention view has no transcript, status area, composer or empty-project prompts/buttons. Restart/Delete are disabled, and session-specific palette actions and Close shortcut have no hidden target. The Project bar and sidebar remain available.
- Filtering hides rather than unloads sessions: agents keep running, and drafts, disclosures and scroll positions survive. Returning to All restores the remembered conversation without moving focus into its composer or starting an inactive session; select that session explicitly to resume it.
- **Switch session…**, session-cycling shortcuts, New and Resume still reach every open session. Choosing a target outside Needs attention switches to All so its selected row is visible. Sidebar arrow navigation follows visible rows only. Closing the last visible attention session leaves the view blank. Successful tree deletion instead selects a surviving attention row, or falls back to All when none remain.
- The chosen view is remembered per project. Attention is live window-local state, not reconstructed from history after reopening. Desktop notification preferences do not affect it.

A session hidden by Needs attention can still finish and become unread; its row appears without changing the blank conversation area or stealing focus. Pop-outs for hidden conversations are hidden too. New arrivals do not reset sidebar scrolling; removing rows can still clamp scrolling when the list becomes shorter.

### Reload (Restart session)

The reload-style icon in the **Project bar** restarts the selected session's Pi process, not the window or conversation. **Restart session** is also in the command palette for saved sessions.

- Disabled with no selected session, for temporary/offline-demo sessions, before the first verified save, and while a session starts, closes or restarts. New persistent sessions become restartable after Pi writes their file.
- Stops and reaps only that session's agent, then resumes its exact saved file in the same sidebar entry and conversation area. The draft remains. Saved history is reloaded; disclosure/scroll presentation follows the normal explicit-resume boundary.
- Confirms before interrupting active/pending work. Queued and in-flight work do not continue. Prompts are never replayed; unacknowledged submissions remain uncertain and newer drafts are retained.
- Works after a process disconnects. Failed shutdown or resume leaves the session visible with an error; shutdown failure never launches a replacement process. Retry is explicit.

The composer's **Stop** interrupts work without ending its process. Use Restart as the escape hatch for a stuck saved session; Close remains available for temporary or unsaved sessions.

### Delete session tree

Use the **trash icon immediately left of Close** on a session row to delete that saved session **and every descendant** created by forks/clones. It opens the existing tree-confirmation dialog without switching to or resuming that conversation. **Close** only closes the session and retains saved history.

The **trash icon beside Restart** in the Project bar and **Delete session tree…** in the command palette still target the selected saved session and its descendants.

- Nimrod reads Pi session headers and deletes the JSONL files directly in Rust. No Pi worker, installed delete-tree plugin, runtime executable or chat `/delete` command is required. Removal is permanent, not a move to the OS trash.
- Disabled for temporary/offline-demo and unsaved sessions, during lifecycle transitions, or while the selected agent has active/pending work. Every affected open session, including descendants in other Nimrod project windows, must be idle; otherwise deletion is refused without stopping those agents.
- A custom in-app dialog, styled consistently with the command palette, normally opens directly with the populated confirmation. A **Loading session tree…** spinner (with Delete disabled) appears only if preparation takes more than about 150 ms, avoiding a loading-state flash on fast previews. The scrollable tree has compact, evenly spaced rows, session icons and subtle branch guide lines. Long names and secondary path/project details wrap in an aligned text column. Cancel or Esc during loading dismisses it and prevents a late preview from reopening it or deleting anything; the native preview/coordination may still finish in the background before new launches are available. The dialog appears only in the initiating window. Cross-project descendants show their project directories; only affected projects participate in idle/lock acknowledgements. Its action buttons stay visible while the tree scrolls. **Cancel** (or Esc) retains everything; **Delete N sessions** confirms removal of those conversations, drafts and references. Paths appear only when names need disambiguation. While reviewing, affected composers are locked and new session launches are blocked; unrelated running conversations are not stopped.
- After confirmation, Nimrod revalidates the tree, waits for affected agents to exit, then rechecks and removes the files children-first. A failed descendant prevents removal of its ancestors. Confirmed successes disappear from the sidebar/history picker, with their drafts, recovered text, remembered entries and saved pop-out windows/snapshots removed. Failed sessions retain their state with an explicit error.
- Once the subtree is removed, select the next surviving row in the current sidebar view, or the previous row if none follow. If Needs attention has no candidates, switch to All. If no sessions remain, show the empty project—never start a new conversation automatically.
- A failed shutdown, changed tree or unknown outcome is never automatically retried. Sessions involved after shutdown begins are marked **Recovery needed**, including across app restart. Choose **Resume session…** (or an exact session file) explicitly to validate a retained file and recover it. Selecting its sidebar row or pressing Restart cannot bypass that recovery guard. New launches stay blocked until the native transaction finishes; an unreadable/corrupt deletion-state file also blocks launches.

Deletion coordinates only Nimrod-owned agents, not terminal Pi, editor extensions or other applications writing these files. Custom stores are supported through Pi's session-directory environment override; arbitrary exact-file locations outside the selected store cannot be deleted by this action. Store scanning refuses unreadable/invalid headers, symlinks and hard-linked sessions rather than silently omitting possible descendants; the error identifies the file. Minimal path-only deletion guards prevent stale remembered entries from reopening after missed events or restart; conversation/draft/reference content is removed. Storage cleanup failures are reported rather than hidden.

## Boundaries

Pi owns conversation history; Nimrod keeps drafts separately. Resume is not process continuity or restoration of every abandoned/pre-compaction branch. Do not resume a file still used by another Pi/editor process: Nimrod prevents duplicate writers within its own process, not external writers.

Settings and Runtime preferences are described in [Settings](settings.md). Native menu/picker, focus and platform behavior still require user acceptance; fixture tests do not establish those guarantees. Detailed lifecycle, storage and verification guidance lives in the [implementation reference](../.agents/skills/features/references/projects-and-sessions.md).
