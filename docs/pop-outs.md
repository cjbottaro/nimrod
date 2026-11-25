# Pop-outs

Hover an assistant turn to reveal **Pop out response** in its upper-right corner. The button also appears on keyboard focus. Click it to open the response text, including code blocks, in a separate reference window. Reasoning and tool cards stay in the transcript. To open just one code block, use its **Pop out** icon next to **Copy**.

## Trim a response

The trim slider sits next to **Copy source**. Click or grab either handle to select it. The selected handle fills in and is the one the arrow keys move. Click the rail to move and select the nearer handle, or press Tab to switch handles. Each stop is the boundary of a whole paragraph, heading, list, table, quote, or code block. When the handles touch, the preview is empty. Move them apart to show content again, or move them all the way to the ends to restore the full response.

**Copy source** copies the kept Markdown. Reference-style links still work in the Pop-out, but their definitions aren't copied if they're outside the kept range. Saved Pop-outs remember the trim; it never edits the transcript or discards the rest of the snapshot.

## What you get

- A separate window containing the captured content. Later agent output does not update it.
- Global [typography preferences](settings.md#typography) update existing reference windows: conversation fonts for Markdown prose and monospace fonts for code. The captured source stays unchanged.
- [Syntax highlighting](syntax-highlighting.md) for labeled code, including Elixir, and languages detected from user code; formatted rendering for Markdown. Pop-outs preserve their captured language rather than guessing again.
- **Copy** copies source rather than rendered text. Markdown has a **Copy source**
  icon; nested code blocks have their own **Copy** buttons.
- A short content-based window title, without a redundant session/snapshot header.
- HTTP(S) links, including the native right-click menu's **Open Link / Open URL**, open your default browser rather than replacing the reference window.
- Opening identical responses in the same session focuses the existing window. Code blocks match other code blocks by content and language, not responses.

## Sessions and persistence

Only the active project's selected-session pop-outs are visible. Switching project
windows (for example, ⌘\` on macOS) hides the previous project's pop-outs and shows
the incoming project's. Switching sessions does the same within a project.
Focusing a pop-out itself keeps its project's references visible.

| Action | Result |
| --- | --- |
| Quit and reopen the saved session | Restore its pop-outs and window positions/sizes |
| Close the source session or project | Keep saved pop-outs for reopening that session |
| Close a pop-out, or press ⌘W / Ctrl+W in it | Remove that pop-out, without affecting the session |
| Successfully delete the source session tree | Remove references belonging to the deleted sessions, including saved snapshots |

On macOS, ⌘\` cycles project windows, skipping pop-outs. Click a pop-out to focus
it; ⌘W still closes it. Automatic restoration leaves keyboard focus on the composer
or active dialog.

Pop-outs from temporary sessions and non-Pi sessions last only for the current run. Pi sessions gain persistent Pop-outs after the first verified save. Compaction does not remove
captured content. Pop-outs do not provide editing or “Show in conversation.”

Snapshots are stored in `~/.local/state/nimrod/popouts/`, with references in app-managed
state. `XDG_STATE_HOME` can change that root; Pi's session files are untouched.
If a snapshot cannot be saved or restored, Nimrod reports the error.

Native Linux/possible Windows focus behavior and multi-display restoration remain unverified.
