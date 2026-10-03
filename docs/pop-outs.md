# Pop-outs

Keep a code block visible while the conversation continues: click its **Pop out**
icon, to the left of **Copy**. Copy briefly becomes a checkmark after success.

## What you get

- A separate window containing the captured content. Later agent output does not update it.
- Syntax highlighting for code; formatted rendering for Markdown.
- **Copy** copies the original source. Markdown has a small upper-right Copy source
  icon; nested code blocks have their own Copy buttons.
- A short content-based window title, without a redundant session/snapshot header.
- Clicking Pop out on identical content and language in the same session focuses
  the existing window—even if that content appears in another turn.

## Sessions and persistence

Only the selected session's pop-outs are visible in each project window.
Switching sessions hides/shows their windows.

| Action | Result |
| --- | --- |
| Quit and reopen the saved session | Restore its pop-outs and window positions/sizes |
| Close the source session or project | Keep saved pop-outs for reopening that session |
| Close a pop-out, or press ⌘W / Ctrl+W in it | Remove that pop-out, without affecting the session |

On macOS, automatic restoration leaves keyboard focus on the composer or active
dialog. Explicitly clicking Pop out focuses the reference window.

Temporary/demo pop-outs last only for the current run. New saved sessions gain
persistent pop-outs after Pi's first verified save. Compaction does not remove
captured content. Pop-outs do not provide editing or “Show in conversation.”

Snapshots are stored in `~/.local/state/nimrod/popouts/`, with references in app-managed
state. `XDG_STATE_HOME` can change that root; Pi's session files are untouched.
If a snapshot cannot be saved or restored, Nimrod reports the error.

Native Windows/Linux focus behavior still needs verification. See
[verification](verification.md) for tested behavior and remaining platform checks.
