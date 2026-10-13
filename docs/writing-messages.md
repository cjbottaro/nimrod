# Writing messages

Focus the **prompt field** in the composer, write a message and press Enter. Pi determines the available models, tools and extensions. [Paste images](image-paste.md) to attach screenshots or send an image-only message.

## Send, steer or queue

| Key | Idle | Main agent working |
| --- | --- | --- |
| **Enter** / Send | Send a message | Steer the current run |
| **Option+Enter** (macOS), **Alt+Enter** (Linux) | Send a message | Queue a follow-up |
| **Shift+Enter** | Newline | Newline |

Background subagent activity alone does not enable follow-up queueing. Composer delivery keys are not part of the [keybinding editor](keybindings.md).

### Immediate transcript feedback

Ordinary messages appear in the transcript immediately, without waiting for Pi and without a sending/pending label. Image messages appear after their local image preparation finishes. Pi’s actual user message reconciles in place, without a duplicate turn. This preserves your transcript reading position and does not steal focus or change a newer draft. Send also immediately moves the session to the top of All/Working and scrolls that session list to the top; it does not wait for image preparation or Pi's response. Unread keeps its arrival order and list position.

Rejected local turns remain marked **Not sent**; cancelled ones show **Cancelled**, and uncertain ones show **Acceptance unknown**. An acknowledged message disconnected before its actual user event shows **Delivery unconfirmed**. Previews are not saved as conversation history, and nothing retries automatically.

Slash commands do not create literal previews because Pi may handle them as controls or expand their content.

### Steering messages

A steer immediately appears at the bottom of the transcript after live output, with a **STEERING** status. The status stays visible until Pi adds the actual user message to the transcript, then disappears as the turn reconciles in place without a duplicate. There are no intermediate sending/accepted/consumed labels. Steering turns are never sticky. Visible or acknowledged does not mean the agent has consumed it.

The Status area shows the authoritative steering and queued follow-up counts; message text appears in the transcript.

Rejected local steering turns remain marked **Not sent**; the error also appears in that session's notices above the transcript pane. Uncertain previews remain labeled **Acceptance unknown**. An acknowledged steer disconnected before confirmed consumption shows **Delivery unconfirmed**. Nothing retries automatically.

### Queued messages

Queued follow-ups appear as normal user turns pinned to the bottom of the transcript pane, even while you read older history. They use the same styling and spacing as other user turns, with no queue separator. New assistant/tool output continues above them. Multiple queued turns stack in order; a long stack scrolls independently.

Their status is simply **QUEUED** throughout the wait. They stay pinned until Pi consumes them as actual user turns, then lose the status and stickiness in place, without a duplicate. Accepting a message into Pi’s queue is not the same as consuming it.

**STEERING** and **QUEUED** use the usual UI font in uppercase with spaced-out letters, without trailing dots, and have a subtle highlight that sweeps across the text from left to right. With reduced motion enabled, the labels remain static. Outcome/error labels do not animate.

Rejected, cancelled or uncertain queued sends become non-sticky turns with the same outcome labels as other sends. Disconnect also unpins them with an **Acceptance unknown** or **Delivery unconfirmed** label. Nothing retries automatically, and newer drafts remain unchanged.

## Stop and recover

**Stop** clears queued work for explicit recovery, then aborts the main agent. During compaction it aborts without clearing queues.

Returned nonempty queue text appears with **Restore** controls in the Status area. Restore puts text back for editing; it does not send it. Pi returns text only, so image attachments are not restored; paste them again if needed. This is separate from failed-send handling.

## Send outcomes

Send immediately clears the submitted text and images from the composer, including while images are being prepared. You can write and send another message without waiting for Pi's acknowledgement. Image preparation briefly delays another send until its payload is ready, not until acknowledgement.

- **Successful request:** no additional composer change, sidebar movement or recovery copy.
- **Definitely not sent:** show the error. The message is not restored; type a new message if needed.
- **Acceptance unknown:** show an error explaining that Pi may have received the message. No restore/retry action or extra submission gate is added. Sending still requires a connected, available session.

Results never change newer text/images, even if you retype exactly the same message, and never repeat or undo Send's sidebar ordering/scroll effects. Only Pi's response establishes acceptance; later model/provider failures leave accepted messages in the transcript. Disconnect, reload and Restart never replay a prompt. Submission tracking is not saved as draft recovery.

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
