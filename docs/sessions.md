# Sessions

Each session has its own conversation, draft and agent process. Switching sessions leaves background work running and preserves reading position and expanded cards.

## Create a session

| Action | Use |
| --- | --- |
| **New session** / **⌘/Ctrl+N** | Start a normal persistent Pi conversation. |
| **New named session…** / **⌘+Option+N**, **Ctrl+Alt+N** | Enter a single-line name, then press Enter or Create. Escape cancels. Requires Pi's native `--name` support. |
| **New temporary session** / **⌘/Ctrl+Shift+N** | Start without saved conversation history. Closing, quitting or reloading discards its drafts, recovery items and pop-outs. |

Pi writes persistent history. Until the first verified save, the Project bar shows **Pi · awaiting first save** and Restart is disabled. Naming an empty session alone may not save it. Once saved, the badge becomes **Pi**; hover for its file path.

## Switch or resume

- Click a Session sidebar row, or use **Switch session…** / **⌘/Ctrl+T** for every open session, including disconnected, temporary and filtered-out rows.
- Use **Resume session…** / **⌘/Ctrl+K** to search saved top-level history for this project by name, preview or path. **—** marks closed history; already-open entries keep their activity indicator. Press Enter or click to select. Refresh retries discovery.
- **Resume last session** explicitly opens the remembered file/project pair.

Choosing an already-open entry reuses it. Selecting an inactive saved session loads its history and connects Pi without sending a prompt. Reopening a project restores its remembered sidebar entries without starting them; a visibly selected saved session connects when selected or revealed by navigation.

Resume lists only the configured Pi session store. There is no arbitrary session-file chooser. Child sessions recorded as subagents or forks/branches are excluded from saved-history pickers; closed children have no opening UI.

Missing, malformed, replaced or wrong-project history shows an error without creating a replacement conversation. Resume restores Pi's active context, not an in-flight process, pending queues or every abandoned/pre-compaction branch. Stop other terminal/editor processes using that file first; Nimrod only coordinates its own writers.

See [Session sidebar](session-sidebar.md) for ordering and filtered navigation.

## Close a session

Click its row's **Close** button or use **⌘/Ctrl+W**. Closing waits for that agent to stop.

- Saved history, drafts and saved pop-outs remain available when reopened.
- Temporary state is discarded; temporary or active-work Close asks for confirmation.
- Cancel or failed shutdown keeps the session and draft available.
- Closing a window stops its agents; quitting stops all Nimrod-owned agents. There is no background daemon or process continuity.

After closing or deleting the selected session, Nimrod prefers the most recently used connected session in the current view, then across All. With none connected, it chooses the most recently used remaining session in the current view, then across All if the view is empty. This uses message/creation recency, not row adjacency—even in Unread's arrival-ordered view. Deleting a background session leaves the current selection unchanged. An inactive saved replacement loads and connects immediately unless that specific session is still locked for deletion. Removing the last session never creates one.

## Restart session

Use the Project bar's reload-style icon, **Restart session** in the palette, or **⌘/Ctrl+R**.

Restart stops only the selected saved session's process, then resumes its exact file in the same conversation area. The draft remains; saved history reloads and disclosure state resets. Active/pending work requires confirmation. Queues and in-flight work do not continue, and prompts are never replayed.

Restart is unavailable for temporary sessions, before first save or during lifecycle transitions. Failed shutdown or resume leaves a visible error; retry is explicit. Use [Stop](writing-messages.md#stop-and-recover) to interrupt work without ending its process; Restart is the escape hatch for a stuck saved session.

## Delete session tree

The **trash icon left of Close** targets that row without switching to or resuming it. The Project bar trash icon and **Delete session tree…** / **⌘/Ctrl+Backspace** target the selected saved session.

1. Open deletion review.
2. Inspect the selected session and its descendants, including any in other projects.
3. Choose **Delete N sessions** to stop affected agents and permanently remove the tree, or Cancel/Escape to retain everything without stopping work.
4. The review stays open, showing **Stopping sessions…** and then **Deleting sessions…**. Its actions are disabled after confirmation. It closes when deletion and reconciliation finish.

Deletion is permanent, not a move to OS trash. No Pi deletion plugin is required. Working sessions can be deleted; temporary/unsaved sessions cannot. Nimrod stops affected owned Pi processes and waits for exit before removing files. Confirmation covers the current tree, including descendants created during review or shutdown, without a second review. Review locks only affected sessions. New sessions and unrelated Resume, Restart and Close actions remain available in other project windows, without stopping unrelated work.

Saved-history pickers can contain a stale row if its file is deleted after discovery. Choosing it shows an error; Nimrod never substitutes a new conversation. A session in the active deletion tree cannot attach a new agent until review is canceled or deletion finishes. The reviewing window retains normal modal focus and shortcut priority.

Slower previews show **Loading session tree…** with Delete disabled. Cancel during loading prevents deletion even if preparation finishes later. Enter respects the focused action; Enter on Cancel cancels.

Confirmed successes remove their history files, drafts, recovery items and saved references. A failed descendant retains its ancestors; other branches can succeed. Review-time conversation or draft changes do not require another attempt. Invalid history, shutdown failures, late external file changes and uncertain outcomes still show explicit errors without automatic retry. **Recovery needed** sessions require explicit **Resume session…** after the transaction finishes; row selection or Restart cannot bypass that guard.

Deletion supports Pi's session-directory environment override, not arbitrary locations outside the selected store. Unreadable/invalid headers, symlinks or hard-linked sessions can prevent tree discovery rather than silently omit descendants. External writers are not coordinated.

## Delete several conversations

Use **Delete sessions…** / **⌘/Ctrl+Shift+Backspace** to search saved top-level project history, including open and closed sessions.

Enter/click opens tree review above the still-visible picker without activating the session. Cancel leaves the filter, rows and reading position unchanged. Confirmed-deleted rows disappear in place; selection advances to the next match or previous row at the end. Failed/retained rows stay. The picker remains open, even when empty; Refresh explicitly reloads history. Escape from the picker closes it.

Each deletion includes descendants, not just the listed row.

## Drafts and recovery

[Saved-session drafts](drafts.md) are Rust-managed Nimrod state, separate from Pi history. Legacy webview drafts are ignored without migration. Send clears the composer immediately; acknowledgement tracking is separate and never changes newer edits. Failed or uncertain sends show an error without submission recovery or automatic resend.

**Recover unattached draft…** copies a newly created unfinished draft into a new session without submitting it or consuming the source. Temporary drafts are not recoverable after disposal. Storage failures are reported; abrupt termination is not a durable-draft guarantee.

See [Writing messages](writing-messages.md), [Paste images](image-paste.md) and [Pop-outs](pop-outs.md). Native multi-window lifecycle, deletion failure/recovery and platform focus edge cases remain incompletely verified.
