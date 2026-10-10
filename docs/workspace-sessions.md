# Projects and sessions

## Projects

A project is a directory—no Git repository, manifest or registration required. One canonical directory belongs to each project window and is the working directory of its sessions. Its path stays visible in the **Project bar**.

- Use **File → Open project…** (**⌘/Ctrl O**) for the native directory-only chooser. **Open recent project…** (**⌘/Ctrl ⇧ O**, configurable in Settings → Keybindings) opens the searchable recent-project picker and is also available in the command palette and File menu. Entries are single rows: the model/thinking pickers' muted **•** marker for an existing window, directory name, muted parent directory, and a right-aligned Enter icon shown only on the selected row. Its space remains reserved so moving selection never shifts text. The dot sits close to the name; unopened projects reserve the same blank slot so names align. Long names/parents truncate without hiding the Enter icon; full paths remain searchable. Recents retain their most-recently-opened order; typing matches both names and paths. Press Enter or click a row to open/focus it; Escape dismisses the picker. There is no folder-picker button in this modal—use **File → Open project…** / **⌘/Ctrl O** to browse a new directory. Missing/moved directories fail without starting a session or substituting another project. You can also select a directory on the welcome screen, or run `nimrod /path/to/project` after installing the [terminal launcher](../README.md#terminal-launcher).
- Opening a project never starts Pi. An already-open directory focuses its existing window; another directory opens another project window. The native menu works even when a reference window is focused, and opens a project window rather than rebinding the welcome screen.
- The recent-project list remembers opened directories, not just directories with sessions. Your home directory can appear if it was opened as a project. The **•** marker means that project already has a window, not that it is the current project or has saved sessions. A project with no remembered open sessions opens an empty window; use **Resume session…** to look for closed history or **New session** to start one. There is currently no UI action to remove a directory from recents.
- Gitignored worktree subdirectories can live inside a project. Sessions launched in those directories currently require separate project windows; nesting alone does not group them under the parent project.

### Terminal launches

Rapid commands such as `nimrod .; nimrod /another/project` should open/focus project windows in one app instance on macOS, even from a cold start. **⌘ + backtick** remains macOS's native window cycling; it is separate from session switching and the Settings keybinding editor. Opening a project never starts or resumes an agent.

When testing a new build, quit the old Nimrod first: launching a different app bundle while Nimrod is running forwards to that existing build. The terminal command returns when macOS accepts the launch, not when window routing or focus completes.

The startup fix has isolated process/socket regression coverage. Native Launch Services forwarding and window cycling still require user validation; Linux/Windows keep their existing single-instance integration and have not been verified for this change.

## Session management

### Open sessions

The **Session sidebar** shows a flat list of open conversations, activity and per-row trash/Close controls. **Open** means retained in the sidebar, not necessarily connected. **Connected** means the session has a live connection to its Nimrod-owned agent process; that agent may be idle or working. Restored or disconnected entries are still open. Hiding the sidebar or filtering a row out of Unread or Working does not close it. **New session** starts a persistent conversation. Selecting another session leaves background agents running and retains each conversation's draft, disclosures and scroll position.

**⌘/Ctrl ⇧ P** opens the keyboard-only **Command palette**:

- **Switch session…** lists every session retained in the sidebar, connected or disconnected, including temporary sessions and rows filtered out of Unread or Working. Rows match the sidebar: the same status indicator beside the title, with muted **relative time · date** underneath—no visible status text. It does not search closed history.
- **Resume session…** searches saved top-level project history by name, preview or path, including both already-open and closed sessions. Rows use the same indicator, title and muted **relative time · date** layout as Switch and the sidebar; previews and paths remain searchable but are not shown as a separate subtitle. Already-open entries show their current sidebar state/time; closed history shows a **—** indicator (distinct from the **○** for an open-but-inactive session) and remembered/latest saved user-message time (or **No message time** when unavailable). The left indicator identifies closed history versus an open session's current activity, even if disconnected or filtered out of Unread or Working. Open/Closed and activity remain searchable and accessible. Both session pickers show the same right-aligned Enter icon as Open recent project, only on the selected row; its space stays reserved on all rows. There is no Open badge. Selecting an open session reuses its existing sidebar entry; connected sessions keep their process, and inactive sessions resume normally. Unlike Switch, its scope is saved history, not sidebar membership. Pi files with a parent (persisted subagents and saved forks/branches) are excluded from this picker. Closed child sessions cannot currently be opened through Nimrod. Refresh retries history loading.
- **New named session…** collects a single-line name with an inline Create button. Enter creates; Esc cancels. Naming alone does not save empty history. The Pi runtime must support its native `--name` option.
- **New temporary session** is an explicit alternative. Temporary conversations are absent from saved history. Their drafts, recovered/uncertain submissions and pop-outs are runtime-only and are discarded on Close, window close, quit or reload; they are not available through draft recovery.
- History comes from the configured Pi session store. There is no arbitrary session-file chooser or offline-demo command; offline processes remain automated test fixtures only.
- **Recover unattached draft…** explicitly copies retained text into a new session. Nothing is submitted automatically.

### Command interactions

**Escape cancels and closes the entire command interaction in one press**, whether you are searching commands, opening a project, switching/resuming a session, naming a new session, or selecting a model/thinking level. This is the same from the command palette, a direct keybinding, or a status-area button. Prior focus is restored without changing your draft or stopping background agents.

The **model** and **thinking-level (effort)** pickers mark the current value with a typographic **•** beside its label. Unselected options reserve the same blank space so labels align. The bullet is slightly larger than the status-area separator, not a session status indicator; keyboard navigation and hover highlight rows independently without changing the current value.

The **Back arrow** explicitly returns from a picker to commands, retaining the command search query. Escape is cancellation, not Back. Pending picker results are discarded after cancellation; no command is run or retried. Genuine nested dialogs, such as a key recorder inside Settings or a Pi extension dialog above the palette, still dismiss only themselves.

Closing a session waits for its agent to stop before removing it from the sidebar. Saved-session history and drafts remain; temporary state is discarded entirely. Active work and temporary sessions require confirmation: **Enter** confirms Close; **Esc** cancels. Canceling Close or a failed agent shutdown keeps the session and its in-memory draft available. A closed session has no Nimrod-owned Pi process; an open session may be inactive. Reopening a project restores saved sidebar entries without starting Pi; selecting one resumes it. Closing a project window stops only its children; quitting stops all owned children. No background daemon.

When Close or successful deletion removes the selected session, Nimrod prefers the **most recently used connected session** in the current sidebar view, then across **All** (switching views if needed). “Most recently used” follows creation/history time and acknowledged prompts, not clicks or connection time. If none are connected, it selects the next surviving row, or the previous row when none follow; an exhausted filter falls back to All. **Both actions load and connect an inactive saved replacement.** Deletion waits for its transaction to finish; failed/unknown deletion outcomes still require explicit recovery. Removing a background session leaves the surviving selection unchanged; removing the last session never creates one.

Default shortcuts (customizable in [Settings → Keybindings](keybindings.md)): **⌘/Ctrl N** creates a session, **⌘ Option N / Ctrl Alt N** opens New named session, **⌘/Ctrl ⇧ N** creates a temporary session, **⌘/Ctrl T** searches open sessions, **⌘/Ctrl K** searches saved project history, **⌘/Ctrl Backspace** opens deletion review, **⌘/Ctrl M** selects a model, **⌘/Ctrl E** selects thinking level/effort, **⌘/Ctrl W** closes it, **⌘/Ctrl B** toggles the sidebar, and **⌘/Ctrl ⇧ [ / ]** switches to the previous/next open session in the sidebar's **All** order, wrapping at either end. Cycling still covers all open sessions when the sidebar is hidden or filtered; a filtered-out target switches the view to All.

### Session navigation

The sidebar's **All** view, **Switch session** picker and previous/next shortcuts share the same most-recently-used order. Switching does not change that order; only creation, historical resume seeds and Pi-acknowledged prompts establish recency. Previous/next wraps at either end and reaches all open sessions even when the sidebar is hidden or filtered.

**Unread** intentionally uses arrival order; **Working** filters All's order. Sidebar arrow-key focus follows the rows currently displayed. Switch or cycling to a filtered-out session returns to All. Filtering alone never starts an agent; any visibly selected saved session loads and connects, including automatic Close/deletion replacements (deletion waits for transaction completion). Connection/loading is shared behavior, not something each navigation action implements separately. Launch barriers defer the latest selected target; failed launches remain visible errors rather than automatic retries. **Resume session** remains a separate saved-history picker, not an open-session projection.

## Sidebar width

Drag the sidebar's right edge to resize it. Width is remembered per project in app state, independently of All/Unread/Working and whether the sidebar is hidden. A narrower window temporarily caps the width; your preferred size returns when space is available. Narrow windows retain the existing overlay sidebar.

- Focus the resize handle with Tab, then use **Left/Right** for 10px changes, **Shift+Left/Right** for 50px, or **Home/End** for the current limits.
- **Double-click** the edge to restore the default width. **Escape** cancels an unfinished drag without saving.
- Resizing keeps sessions running and retains drafts, disclosures, composer focus and transcript follow/reading intent. It does not reorder sessions.

### Sidebar views

Choose **All (8)**, **Unread (2)** or **Working (3)**. Every view shows its session count, including zero; counts can overlap and do not count messages.

- **All** shows every open session, most recently used first.
- **Unread** includes unread completed responses, outstanding input requests and session failures. Ordinary idle sessions, tool output and saved history do not enter this view.
- **Working** shows currently working sessions, including compaction and reported subagent activity, in All's recency order. Input-waiting, inactive and lifecycle-transition sessions are excluded. A selected session remains readable when it finishes until you leave the view; it no longer contributes to the Working count. The empty view says **No sessions working.**

- **New sessions start at the top**, timestamped at creation. **Resume inserts into the correct historical position** using remembered recency or the latest saved user-message timestamp—not file modification time or the moment of resume. Saved-session recency survives Close and project/app reopening; deletion removes it. Older entries without a usable timestamp retain stable open-order ties at the bottom.
- After insertion, All's **last used** changes only when Pi acknowledges a message (`prompt` request), including steering and queued messages. Selecting, reading, renaming (`/name`), changing models, compaction and resuming do not mark a session as used now. Clicking Send alone, rejected/uncertain submissions, background output and completion do not update it. Historical timestamps only seed navigation metadata; they never acknowledge or clear an uncertain draft.
- Each row's second line is **relative time · date**, such as `2 hours ago · Jul 17` (including the year for older years). It uses the same timestamp as sorting. Unknown timestamps show **No message time**. Labels refresh once a minute while visible and when the window returns to the foreground; this changes text only, never order, selection, focus or scrolling.
- The left indicator carries state: a hollow circle for inactive, a small solid dot for ready, a prominent ringed dot for unread, a spinner for working/sending/lifecycle transitions, `?` for input needed, `!` for failure and `↻` for recovery needed. Compaction is distinguished in the accessible state label. Spinners respect reduced motion. State remains accessible without row tooltips.
- Reordering preserves a visible sidebar row's position rather than jumping to the top or following the moved session. Clicking an already-visible row does not add a scroll; explicit palette/shortcut navigation and New/Resume reveal their target. Returning from either filtered view to All reveals the remembered selected session. Content shrinking can still clamp scrolling.
- With no visible Unread rows, that view shows **“N sessions working…”** while agents are busy (including compaction), with gently pulsing dots. Reduced-motion preferences disable the pulse. **“No unread sessions”** appears only when none are working.
- Unread arrivals append to the bottom; updates never reshuffle existing inbox rows.
- Visiting clears an unread response, but keeps that row visible while selected. It disappears when you leave, unless it still needs attention. Reading does not answer an input request or clear a failure.
- Input requests clear when answered/canceled; failures clear when new work or an explicit relaunch starts. There is no separate dismiss action yet.
- The conversation area shows only a selected session in the current view. Switching to Unread or Working from a session outside that filter leaves it blank—even if other matching rows are available. Select a row to read it; new arrivals never open themselves.
- A blank filtered view has no transcript, status area, composer or empty-project prompts/buttons. Restart/Delete are disabled, and session-specific palette actions and Close shortcut have no hidden target. The Project bar and sidebar remain available.
- Filtering hides rather than unloads sessions: agents keep running, and drafts, disclosures and scroll positions survive. Returning to All restores the remembered conversation without moving focus into its composer, loading/reconnecting it if inactive.
- **Switch session…**, session-cycling shortcuts, New and Resume still reach every open session. Choosing a target outside the current filter switches to All so its selected row is visible. Sidebar arrow navigation follows visible rows only. Close and successful deletion use the connected-first replacement rule above, switching to All when needed. Both load/connect an inactive saved replacement; deletion waits for transaction completion.
- The chosen view is remembered per project. Unread and Working are live window-local state, not reconstructed from history after reopening. Existing Needs attention selections migrate to Unread. Desktop notification preferences do not affect it.

A session hidden by a filter can still finish and become unread; its Unread row appears without changing the blank conversation area or stealing focus. Pop-outs for hidden conversations are hidden too. New arrivals do not reset sidebar scrolling; removing rows can still clamp scrolling when the list becomes shorter.

### Reload (Restart session)

The reload-style icon in the **Project bar** restarts the selected session's Pi process, not the window or conversation. **Restart session** is also in the command palette for saved sessions, with configurable **Cmd/Ctrl+R**.

- Disabled with no selected session, for temporary sessions, before the first verified save, and while a session starts, closes or restarts. New persistent sessions become restartable after Pi writes their file.
- Stops and reaps only that session's agent, then resumes its exact saved file in the same sidebar entry and conversation area. The draft remains. Saved history is reloaded; disclosure/scroll presentation follows the normal explicit-resume boundary.
- Confirms before interrupting active/pending work. Queued and in-flight work do not continue. Prompts are never replayed; unacknowledged submissions remain uncertain and newer drafts are retained.
- Works after a process disconnects. Failed shutdown or resume leaves the session visible with an error; shutdown failure never launches a replacement process. Retry is explicit.

The composer's **Stop** interrupts work without ending its process. Use Restart as the escape hatch for a stuck saved session; Close remains available for temporary or unsaved sessions.

### Delete session tree

Use the **trash icon immediately left of Close** on a session row to delete that saved session **and every descendant** created by forks/clones. It opens the existing tree-confirmation dialog without switching to or resuming that conversation. **Close** only closes the session and retains saved history.

The **trash icon beside Restart** in the Project bar and **Delete session tree…** in the command palette still target the selected saved session and its descendants.

- Nimrod reads Pi session headers and deletes the JSONL files directly in Rust. No Pi worker, installed delete-tree plugin, runtime executable or chat `/delete` command is required. Removal is permanent, not a move to the OS trash.
- Disabled for temporary and unsaved sessions, during lifecycle transitions, or while the selected agent has active/pending work. Every affected open session, including descendants in other Nimrod project windows, must be idle; otherwise deletion is refused without stopping those agents.
- A custom in-app dialog, styled consistently with the command palette, normally opens directly with the populated confirmation. A **Loading session tree…** spinner (with Delete disabled) appears only if preparation takes more than about 150 ms, avoiding a loading-state flash on fast previews. The scrollable tree has compact, evenly spaced rows, session icons and subtle branch guide lines. Long names and secondary path/project details wrap in an aligned text column. Cancel or Esc during loading dismisses it and prevents a late preview from reopening it or deleting anything; the native preview/coordination may still finish in the background before new launches are available. The dialog appears only in the initiating window. Cross-project descendants show their project directories; only affected projects participate in idle/lock acknowledgements. Its action buttons stay visible while the tree scrolls. **Cancel** (or Esc) retains everything; **Delete N sessions** or **Enter** confirms removal of those conversations, drafts and references. Enter does nothing while the preview is loading. Paths appear only when names need disambiguation. While reviewing, affected composers are locked and new session launches are blocked, but sidebar rows keep their normal idle/inactive/unread indicators. Only confirmed shutdown/removal shows **Deleting**; deletion never counts as agent work. Unrelated running conversations are not stopped.
- After confirmation, Nimrod revalidates the tree, waits for affected agents to exit, then rechecks and removes the files children-first. A failed descendant prevents removal of its ancestors. Confirmed successes disappear from the sidebar/history picker, with their drafts, recovered text, remembered entries and saved pop-out windows/snapshots removed. Failed sessions retain their state with an explicit error.
- Once the subtree is removed, keep a surviving selection or use the same connected-first replacement rule as Close. Select the most recently used connected session in the current view, then All; only when none are connected use next/previous inactive fallback. After the transaction finishes, an inactive replacement is resumed if it remains selected and is not quarantined. No new conversation or prompt is created.
- A failed shutdown, changed tree or unknown outcome is never automatically retried. Sessions involved after shutdown begins are marked **Recovery needed**, including across app restart. Choose **Resume session…** explicitly to validate a retained file and recover it. Selecting its sidebar row or pressing Restart cannot bypass that recovery guard. New launches stay blocked until the native transaction finishes; an unreadable/corrupt deletion-state file also blocks launches.

Deletion coordinates only Nimrod-owned agents, not terminal Pi, editor extensions or other applications writing these files. Custom stores are supported through Pi's session-directory environment override; arbitrary exact-file locations outside the selected store cannot be deleted by this action. Store scanning refuses unreadable/invalid headers, symlinks and hard-linked sessions rather than silently omitting possible descendants; the error identifies the file. Minimal path-only deletion guards prevent stale remembered entries from reopening after missed events or restart; conversation/draft/reference content is removed. Storage cleanup failures are reported rather than hidden.

## Boundaries

Pi owns conversation history; Nimrod keeps drafts separately. Resume is not process continuity or restoration of every abandoned/pre-compaction branch. Do not resume a file still used by another Pi/editor process: Nimrod prevents duplicate writers within its own process, not external writers.

Settings and Runtime preferences are described in [Settings](settings.md). Native menu/picker, focus and platform behavior still require user acceptance; fixture tests do not establish those guarantees. Detailed lifecycle, storage and verification guidance lives in the [implementation reference](../.agents/skills/features/references/projects-and-sessions.md).
