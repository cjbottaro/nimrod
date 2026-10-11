# Writing messages

Focus the **prompt field** in the composer, write a message and press Enter. Pi determines the available models, tools and extensions. [Paste images](image-paste.md) to attach screenshots or send an image-only message.

## Send, steer or queue

| Key | Idle | Main agent working |
| --- | --- | --- |
| **Enter** / Send | Send a message | Steer the current run |
| **Option+Enter** (macOS), **Alt+Enter** (Linux) | Send a message | Queue a follow-up |
| **Shift+Enter** | Newline | Newline |

Background subagent activity alone does not enable follow-up queueing. Composer delivery keys are not part of the [keybinding editor](keybindings.md).

### Steering messages

A steer immediately appears at the bottom of the transcript after live output. **Sending…** becomes **Pending steering** when Pi acknowledges it; the label disappears when Pi emits the actual user message, without a duplicate turn. Visible or acknowledged does not mean the agent has consumed it.

The Status area shows the authoritative steering count. Explicit follow-up text stays in its queue there.

Rejected/uncertain messages remain labeled **Not sent** or **Acceptance unknown**. An acknowledged steer disconnected before confirmed consumption shows **Delivery unconfirmed**. Nothing retries automatically.

## Stop and recover

**Stop** clears queued work for explicit recovery, then aborts the main agent. During compaction it aborts without clearing queues.

Returned queue text appears with **Restore** controls in the Status area. Restore puts text back for editing; it does not send it. [Image send recovery](image-paste.md#drafts-and-recovery) is separate because Pi's queue recovery returns text only.

Only Pi acknowledgement clears the unchanged submitted draft. Newer edits survive. An uncertain send stays blocked until you explicitly allow another send; that is not proof the previous request failed. Check the transcript/queue before sending again. Disconnect, reload and Restart never replay a prompt.

Stop keeps the process alive. Use [Restart session](sessions.md#restart-session) for a stuck saved session, or Close for temporary/unsaved sessions.

## Slash commands and compaction

Type `/` for suggestions discovered from Pi.

- `/name` names the session.
- `/compact` is available only while idle and may include optional instructions.
- Automatic and manual compaction are visible and lock the composer until complete.
- Session-management commands such as `/resume` and Pi's `/reload` are unavailable; use Nimrod's session actions instead. Unsupported commands are rejected rather than silently sent as chat.
- Images cannot be combined with slash commands; the draft remains intact.

Slash commands retain Pi's control/expansion behavior, not necessarily a literal optimistic user turn. Supported Pi extension text widgets, statuses and input/select/confirm/editor dialogs work; TUI-only component widgets do not.

See [Model and thinking preferences](model-thinking.md) to change upcoming requests without interrupting a stream.
