# Error messages

**Implementation in progress.** Operational errors now use a shared notice strip;
some generic operation labels and per-operation resolution still need cleanup.
Native macOS and Linux acceptance remains unverified.

## Presentation

- **All application errors:** one shared notice strip in a consistent location
  across the app, including Settings, dialogs and the command palette. Messages
  identify the failed operation instead of moving beside the affected control.
- **Status area:** agent activity, model/thinking, usage and queues—not generic
  error messages.
- **Transcript:** actual agent/tool output, including failures reported as part of
  a conversation. Nimrod's own errors should not become transcript banners.
- **No placement exceptions:** no additional inline errors, banners, flashes or
  status-area error messages. The strip stays visible and usable while a dialog
  is open; you should not have to close it to see an error.

The strip sits below the header at the same position across conversation,
Settings/dialogs, welcome and empty-project screens, with space reserved so it
does not cover content. This single
application-error surface does not replace agent/tool failure output in the
conversation.

Errors should remain until dismissed or resolved, not flash and disappear. One
failure should appear once; unrelated outstanding errors should not silently
replace one another. Notices should not steal focus, switch sessions or pull you
out of older transcript history. Dismissal alone does not retry an operation or
confirm that an uncertain message was received. An unchanged repeated report of a
dismissed issue does not immediately bring it back; a new or changed failure can.

If one failure propagates through several layers, its most actionable notice is
shown once. For example, unknown delivery takes precedence over a generic
connection error. Resolving the delivery gate does not imply reconnection; the
underlying connection notice can remain. Notices do not switch sessions on arrival.

The current [send-outcome behavior](writing-messages.md#send-outcomes) already
separates accepted, definitely not sent and acceptance unknown. Consolidating
error placement must preserve that distinction and never automatically resend a
message.
