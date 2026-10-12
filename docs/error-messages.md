# Error messages

Errors appear where their operation belongs. Some operation labels and matching
resolution still need refinement; native macOS and Linux acceptance is unverified.

## Session notices

Errors belonging to a session appear at the top of its **conversation area**, above
and outside the scrolling transcript, aligned with the transcript's side gutters.
These include connection/startup failures, sending or pasting images, clipboard
actions, Pi notices and model/thinking changes. A failed model/thinking picker
returns to the conversation to show its error.

Only the selected session's notices are visible. Another open session can record
an error while you work elsewhere, but it does not display that error in your
current conversation, the project bar, Settings or the sidebar. There is no shared
Issues counter or error badge. Switch to that session to see its outstanding
notices; switching away and back does not clear them. Existing activity and Unread
behavior remains separate.

Session notices are not conversation entries and do not become Pi history. Actual
agent/provider/tool failures supplied as conversation output remain in the
transcript or their tool card. The **Status area** continues to show activity,
model/thinking, usage and queues—not arbitrary error messages.

## Application notice strip

Window/application problems—such as reading or saving preferences, loading card
plugins, shared draft-store health or notification setup—use the **application
notice strip** below the header. That strip is available across the conversation,
Settings, dialogs, welcome and empty-project screens, with space reserved so it
does not cover content. Its controls remain usable while a dialog is open.

## Reading and dismissing notices

Notices use a neutral surface and a small severity icon. A single issue shows its
summary directly. Multiple issues collapse into an expandable count/list, with a
bounded scrollable area so they do not keep shrinking the transcript. Long messages
and diagnostics are available under **Details**.

Errors remain until dismissed or their own issue resolves; they do not flash and
disappear. Later unrelated success does not clear an earlier issue. One failure
should appear once, even if it propagates through several layers. For example,
unknown delivery takes precedence over a connection error from the same cause.

Dismissal only hides the notice. It does not retry an operation, reconnect Pi or
confirm that a message was received. An unchanged repeated report of a dismissed
issue does not immediately bring it back; a new or changed failure can. Notices do
not switch sessions, steal focus or pull you out of older transcript history.

The [send-outcome behavior](writing-messages.md#send-outcomes) distinguishes
accepted, definitely not sent and acceptance unknown. Errors do not restore the
attempted message, alter a newer draft, add recovery controls or automatically
resend anything.
