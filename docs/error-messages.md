# Error messages

Errors appear where their operation belongs. Some operation labels and matching
resolution still need refinement; native macOS and Linux acceptance is unverified.

## Session notices

Errors belonging to a session appear at the top of its **conversation area**, above
and outside the scrolling transcript, aligned with the transcript's side gutters.
These include startup/connection failures without an owning operation card, image
preparation/paste, clipboard actions, Pi notices and model/thinking picker failures. A failed model/thinking picker
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

## Operation-card outcomes

An existing [operation card](reading-conversations.md#operation-cards) owns its
operation's result instead of adding a duplicate banner. Failed operations show
a red accent, **Failed**, and an **Error details** disclosure when diagnostics
exist. Uncertain outcomes and known non-execution use muted grey accents with
**Outcome unknown** or **Not applied**, and optional **Details**.

Configuration changes, steering/queued messages and failed message previews use
this presentation. The same disconnect is not repeated in a banner when pending
cards already explain its effect; independent session problems still use notices.
These are local presentation records, not extra messages sent to the agent.

## Pending permissions

Copilot's **Waiting for permission · N requests** banner appears first in the
session's banner stack, above errors. It represents a pending decision, not an
error, so its styling is neutral. It has **Review requests** instead of Dismiss
and remains accessible while the error list scrolls. Dismissing the permission
modal does not answer the request; the banner disappears when the pending requests
are answered or cancelled. See [Copilot permissions](copilot.md#permissions-and-questions).

## Application notice strip

Window/application problems—such as reading or saving preferences, loading card
plugins, shared draft-store health or notification setup—use the **application
notice strip** below the header. That strip is available across the conversation,
Settings, dialogs, welcome and empty-project screens, with space reserved so it
does not cover content. Its controls remain usable while a dialog is open.

## Reading and dismissing notices

Session notices use a neutral surface with a thin outline and small icon in the
theme's error color. This is one "needs attention" treatment, not separate visual
warning/error categories. The message itself leads; useful operation context is
secondary, and generic labels such as "Pi operation" are omitted. Application
notices retain their operation heading and severity icon.

Session notices have even internal padding and breathing room above and below the
border. The gap before the transcript stays visible while you scroll. The icon
and Dismiss control align with the first message line, including when the message
wraps or Details is expanded.

Every independent issue has its own banner, actions and dismiss control. There
is no multi-error count/disclosure hiding other issues. Repeated reports of the
same occurrence are deduplicated; unrelated failures with identical wording
remain separate. Banners keep their arrival order, with a bounded, independently
scrolling list so they do not keep shrinking the transcript. Long messages have
a shortened preview with the complete original text under **Details**. Separately supplied
diagnostics also appear there. Unstructured Pi messages are not guessed at or
rewritten to separate a problem from its technical details.

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
