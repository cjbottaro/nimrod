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

Rejected local steering previews are removed; the error appears near the composer. Uncertain previews remain labeled **Acceptance unknown**. An acknowledged steer disconnected before confirmed consumption shows **Delivery unconfirmed**. Nothing retries automatically.

## Stop and recover

**Stop** clears queued work for explicit recovery, then aborts the main agent. During compaction it aborts without clearing queues.

Returned nonempty queue text appears with **Restore** controls in the Status area. Restore puts text back for editing; it does not send it. Pi returns text only, so image attachments are not restored; paste them again if needed. This is separate from failed-send handling.

## Send outcomes

- **Accepted:** clear the submitted text and images. No extra image recovery copy is kept.
- **Definitely not sent:** show the error and discard that attempted message. Write a new message if needed; nothing is restored or retried.
- **Acceptance unknown:** show the uncertainty and block further sends. Check the transcript/queue, then use **Write a new message** to discard the uncertain attempt and continue. This action does not prove the previous message failed.

Newer text/images entered while waiting survive every outcome. Only Pi's response establishes acceptance; later model/provider failures leave accepted messages in the transcript. Disconnect, reload and Restart never replay a prompt.

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
