# Writing messages

Focus the **prompt field** in the composer, write a message and press Enter. Pi determines the available models, tools and extensions. [Paste images](image-paste.md) to attach screenshots or send an image-only message.

The send/steer/queue and slash-control behavior below describes **Pi sessions**. [Copilot SDK slash commands](copilot.md#slash-commands) use Copilot's command API, discovered argument suggestions, harness-requested modal choices and labelled command output—not Nimrod action aliases. [ACP POC sessions](acp.md) accept text while idle, expose their own advertised commands and use Stop rather than Pi steering/queues.

## Send, steer or queue

| Key | Idle | Main agent working |
| --- | --- | --- |
| **Enter** / Send | Send a message | Steer the current run |
| **Option+Enter** (macOS), **Alt+Enter** (Linux) | Send a message | Queue a follow-up |
| **Shift+Enter** | Newline | Newline |

Background subagent activity alone does not enable follow-up queueing. Composer delivery keys are not part of the [keybinding editor](keybindings.md).

### Immediate transcript feedback

Ordinary messages appear in the transcript immediately, without waiting for Pi and without a sending/pending label. Image messages appear after their local image preparation finishes. Pi’s actual user message reconciles in place, without a duplicate turn. Reconciliation does not steal focus, change a newer draft or repeat submission navigation. By default, idle Send jumps to the bottom and enables auto-follow; busy steering and queued follow-ups preserve reading position. Configure **Auto-follow after sending** in [Settings → Appearance](settings.md#appearance). Send also immediately moves the session to the top of All/Working and scrolls that session list to the top; it does not wait for image preparation or Pi's response. Unread keeps its arrival order and list position.

Rejected local turns show a red **Failed** outcome with error details when available. Unconfirmed delivery shows grey **Outcome unknown** with optional details. Ordinary failed/uncertain previews use a **MESSAGE** title. Confirmed user cancellation removes the preview. Previews are not saved as conversation history, and nothing retries automatically.

Slash commands do not create literal previews because Pi may handle them as controls or expand their content.

### Steering messages

A steer immediately appears as a **STEERING** [operation card](reading-conversations.md#operation-cards), pinned in the shared bottom stack with a shimmering title. It stays pending through acknowledgement and queue removal until Pi adds the actual user message. That event adopts the same card at Pi's transcript position, stops shimmering and unpins it. The **STEERING** title remains, without a redundant success label.

The Status area shows authoritative steering and queued counts; message text stays in the transcript. Visible or acknowledged does not mean consumed.

### Queued messages

Follow-ups use the same pattern with a stable **QUEUED** title. Both kinds remain visible while you read older history; a long stack scrolls independently, with ordinary user-turn styling and no queue separator. New assistant/tool entries appear above pending cards.

Titles use the normal UI font, uppercase with spaced letters, in every state. Only pending titles shimmer; reduced motion keeps them static and readable. Failed cards unpin with a red accent, **Failed** and optional **Error details**. Unconfirmed delivery unpins with grey **Outcome unknown** and optional **Details**. Diagnostics appear on the card, not as a duplicate session banner. Newer drafts remain unchanged.

Individual steering/queued cards do not offer Cancel because Pi does not expose targeted queue withdrawal. Nimrod never clears and replays other queued messages to emulate it. The whole-queue Stop/recovery workflow below remains separate. Runtime operation titles are not saved into Pi's history.

## Stop and recover

**Stop** clears queued work for explicit recovery, then aborts the main agent. During compaction it aborts without clearing queues.

Returned nonempty queue text appears with **Restore** controls in the Status area. Restore puts text back for editing; it does not send it. Pi returns text only, so image attachments are not restored; paste them again if needed. This is separate from failed-send handling.

## Send outcomes

Send immediately clears the submitted text and images from the composer, including while images are being prepared. You can write and send another message without waiting for Pi's acknowledgement. Image preparation briefly delays another send until its payload is ready, not until acknowledgement.

- **Successful request:** no additional composer change, sidebar movement or recovery copy.
- **Definitely not sent:** show the error. The message is not restored; type a new message if needed.
- **Acceptance unknown:** show an error explaining that Pi may have received the message. No restore/retry action or extra submission gate is added. Sending still requires a connected, available session.

Results never repeat the submission's transcript jump or change newer text/images, even if you retype exactly the same message, and never repeat or undo Send's sidebar ordering/scroll effects. Only Pi's response establishes acceptance; later model/provider failures leave accepted messages in the transcript. Disconnect, reload and Restart never replay a prompt. Submission tracking is not saved as draft recovery.

Stop keeps the process alive. Use [Restart session](sessions.md#restart-session) for a stuck saved session, or Close for temporary/unsaved sessions.

## Slash commands and compaction

Type `/` for suggestions discovered from Pi.

- `/name` names the session.
- Bare `/mcp` opens the read-only [MCP inspector](mcp.md), without a model request, conversation turn, sidebar-recency bump or transcript navigation. Explicit subcommands still go to Pi.
- `/compact` is available only while idle and may include optional instructions.
- Automatic and manual compaction are visible and lock the composer until complete.
- Session-management commands such as `/resume` and Pi's `/reload` are unavailable; use Nimrod's session actions instead. Unsupported commands are rejected rather than silently sent as chat.
- Images cannot be combined with slash commands; the draft remains intact.

Slash commands retain Pi's control/expansion behavior, not necessarily a literal optimistic user turn. Supported Pi extension text widgets, statuses and input/select/confirm/editor dialogs work; TUI-only component widgets do not.

See [Model and thinking preferences](model-thinking.md) to change upcoming requests without interrupting a stream.
