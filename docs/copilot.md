# Copilot sessions

Nimrod’s built-in Copilot integration uses the **official Copilot SDK**, bundled
with the app. Install and authenticate the Copilot CLI yourself; you do not need
to install an SDK. The pinned SDK 1.0.22 declares CLI **1.0.98** compatibility.
It requires Node `^20.19.0 || >=22.12.0`; the development toolchain uses 25.9.0.
Configure **Settings → Runtime → Copilot executable** and **Node executable** if
desktop executable discovery fails. Account/authentication stays with Copilot.

**Implementation and offline fixtures have not yet been run or accepted in the
native app.** macOS is first, Linux next; SDK packaging, installed-CLI behavior
and native lifecycle still need verification. Windows SDK launch is unavailable.

## Start and send

Open a project, then **⌘/Ctrl+Shift+P → New Copilot session**. This command is
unbound by default and its hint is **Start a Copilot session**. Harness labels
in the Project bar, Session sidebar and history pickers are simply **Copilot**.
Ordinary **New session** and **⌘/Ctrl+N** still create Pi sessions, regardless of
the selected harness.

Text Send clears the composer and previews your turn immediately. It never
replays uncertain delivery or restores sent text over a newer draft. While
working, Enter keeps your draft; there is no steering/queue. **Stop** cancels the
turn, not the saved conversation. A failed connection retains its row and draft;
fix the executable/authentication issue, then reconnect explicitly.

## Permissions and questions

Permission requests use a command-palette-style modal, one request at a time.
Use arrows, typing to filter and Enter, or click a choice. The header shows how
many **more** requests follow this one. Answering advances the same open modal;
it closes only when no requests remain, or when you dismiss it.

**Escape dismisses without answering or denying.** A non-dismissable
**Waiting for permission · N requests** banner stays at the top of this
conversation, above any error banners. Choose **Review requests** to reopen the
queue after inspecting the transcript. Additional requests update the count
without reopening a dismissed modal. Other dialogs keep priority; background
sessions never summon a modal or switch you away from your conversation.

The Status area says **Waiting for permission…** while choices are outstanding.
Alongside **Allow once** and **Deny**, applicable scope-labelled choices include:
- File reads/writes can be allowed for this session. **All file reads/writes**
  means exactly that—not access restricted to the displayed file or directory.
- **Allow for this session** appears for commands only when Copilot explicitly
  permits it. The secondary details show parsed command context when available
  and the exact **Approval scope** Copilot would remember. That scope can be a
  full invocation rather than just an executable; Nimrod does not assume it
  permits arbitrary arguments. Details wrap and are searchable.
- MCP approval can remember the exact server/tool for this session.
- URLs can allow the displayed domain for this session or **always**, explicitly
  labelled **saved across sessions**. This is a domain grant, not a URL-path grant.

Only applicable choices appear. Shell and file-write session approval require
Copilot's explicit capability flag; false or missing flags hide that choice.
Managed-policy and sandbox-bypass requests offer
one-time approval or denial only. Directory-only and saved-project approval are
not currently exposed because the installed CLI's compatibility with those newer
SDK variants has not been verified. Copilot owns remembered rules; Nimrod does not
keep its own approval policy. A session choice does not batch-answer other
already-pending requests.

**Deny with feedback…** opens a separate input modal layered over the unchanged
permission picker. Enter a reason or suggest what to do instead, then choose
**Send denial**. Escape/Cancel closes only that input modal and returns to the
picker without answering. Submitting advances the picker to the next request.

Use **Stop** to cancel the turn (dismiss the picker first if necessary); there is
no ambiguous Cancel request permission button. Questions and plan continuations
retain their separate answers and cancellation controls.

Shell requests show their intention and exact command. File requests show
project-relative paths (absolute outside the project), with **Search directory**
or **Search file** titles when reported; URL requests show **Fetch · URL**.
Supplied changes/arguments and sandbox-bypass requirements remain visible.
**Raw details** stays initially collapsed in the operation context; unknown scopes retain
literal details. Background requests do not steal focus or alter your draft;
return to their conversation to act. Stop/Close/disconnect cancel pending choices
without approving and remove the pending banner. The modal interaction still needs installed-CLI/native
acceptance after a requested build.

## Session configuration

Model, thinking and mode controls use Copilot’s reported catalog and current state,
and accept selections while connected, including during work. Changes apply
when Copilot is idle; a shimmering [configuration change](model-thinking.md)
entry in the transcript shows waiting/application and updates in place if you
choose another value. The Status area keeps confirmed values, without a pending
badge. New sessions read Copilot’s own configured model and effort through the
SDK and use each non-null value at creation—no separate Nimrod preference or
hidden prompt. If either is unset and Copilot has not reported a concrete session
value, it independently displays **default model** or **default effort**, in
lowercase. Actual session-reported values replace the initial creation values.
While the model is unresolved, the effort value/placeholder is visible but
unavailable for selection until supported choices are known; known models without
reasoning support omit the effort control. Resume keeps its saved configuration
rather than applying today’s new-session defaults. Tool/reasoning cards, disclosures, scroll behavior, draft storage and
notification preferences reuse the existing shell. Unknown rich results remain
literal data; no tool payload grants additional permission.

The confirmed controls read `model · effort · mode`. **Select mode…** offers
Interactive, Plan and Autopilot. When Plan finishes, its supported continuation
choices stay inside the owning conversation. The context usage line keeps its
reported percentage and limit; clicking the limit opens **Select context
window…** with tier names as primary labels and reported token amounts as
secondary details. Unsupported controls and palette actions are omitted rather
than shown as Pi equivalents.
Copilot inspection/web cards reuse shared components, including cited web answers
and fetched-content previews when supported by native results. Tool cards appear
while their inputs stream and transition in place when execution begins; late
metadata does not restart completed cards. Failures show the reported error
message, with original JSON available in **Raw output**. **Raw inputs** stays
beneath the result through generation, execution and errors.

**GitHub code search** cards show the query, returned/total counts when supplied,
incomplete-result notices, paths and literal code snippets instead of repeated
JSON. **GitHub contents** shows the repository/path; **Use skill** shows the skill
name and native outcome. Unknown result shapes keep the generic fallback.
Clipped agent-text previews are distinguished from structured search results.
Cards do not repair external MCP header/rate-limit errors or install missing
Copilot skills. Full original output remains available; links open only through
an explicit action. These follow-up card/permission changes still need native
acceptance after a requested build.

Current limits: text-only input; no Restart, steering, queue, Pi MCP inspector
or in-place harness switching. Slash commands use the SDK's supported interface,
not full terminal-UI emulation; see below.
Interactive, Plan and Autopilot sessions are supported through the SDK. Generic
agent protocol infrastructure is retained internally, without a separate
creation action. A mode transition that asks the host for an unsupported extra
model confirmation or automatic continuation reports the limitation and
disconnects rather than guessing or submitting follow-on work.

### Plan and Autopilot

**Plan** asks Copilot to investigate and prepare a plan before implementing.
Review its plan in the owning conversation, then choose one of Copilot's offered
actions, such as **Continue interactively**, **Continue with Autopilot** or
**Finish planning**. **Cancel request** declines the transition. A background
plan request never switches sessions or steals focus.

Use **Plan feedback** and **Request changes** to return revisions to Copilot
without approving implementation. Feedback can also accompany an approval.
**Cancel request** declines without submitting the feedback. None of these
actions sends an extra chat prompt or replaces your composer draft.

**Autopilot** lets Copilot continue through successive steps from one prompt.
Nimrod keeps the session Working across intermediate pauses, retaining tool
cards and pending questions rather than announcing completion at each step.
Queued configuration waits for the task's terminal boundary. **Stop** aborts
the run without changing the saved mode or replacing your newer draft.

Mode is separate from model, thinking effort and permissions. Autopilot does not
grant tool access: permission choices and questions still belong to this session.
Nimrod never sends hidden "continue" prompts or replays your task, and reconnecting
does not automatically continue pending work.

The intermediate-idle handling follows the pinned SDK's completion waiter.
Real CLI completion, sticky Autopilot mode, limits and Stop still need native
acceptance; this is not a claim of full terminal-UI parity.

Empty, isolated-session probes confirmed that ordinary mode changes work with
CLI 1.0.98 without additional host steps. They did not verify model-switch
compaction or a handoff from a distinct planning model to an execution model.
If Copilot requests those unsupported follow-ups, Nimrod reports the specific
limitation and disconnects; reconnect explicitly to read the actual mode/model.
Automatic execution handoffs requiring those extra steps remain unavailable.

## Usage metrics

The Status area uses a compact layout similar to Pi:

```text
~$0.123 · 25.5% / 125k
```

A new session initially displays `~$0.000 · 0% / —`. Those zeros are provisional
display values, not measurements, and remain while the session is untouched even
if successful startup reads return no data. Reported values replace their own
field immediately; actual API errors become `—` instead of being masked by zeros.
Your first valid Send (including a command), or live agent activity, immediately
retires any remaining provisional zeros—without waiting for a result. After that,
unavailable values use `—`; nothing restores the seed. Replayed history and startup
idle events do not consume it. A reconnect starts unknown (`— · — / —`) and uses the
same update path, not a separate implementation. Window size and **Auto compact**
are never guessed.

- **Estimated USD** is the SDK's accumulated session AI-credit usage converted at
  GitHub's published **$0.01 per AIC**. Hover for the AIC amount, accounting coverage
  and exact reported context counters. This is usage value, not necessarily an
  additional charge beyond your subscription allowance.
- **`25.5% / 125k`** is current context utilization and the reported window limit,
  not the total tokens billed over the conversation. The window updates from
  Copilot; it is not hard-coded to 125k. Reconnect reads a context snapshot without
  sending a message or waiting for a live usage event. Exact counters remain in
  the tooltip.
- **`≥$…`** means partial/unknown coverage: the displayed amount is only a reported
  subtotal and the full amount may be higher. **`—` in the cost position** means
  accounting was not reported/read successfully, not that the session was free. A missing
  context count/window displays `— / —` next to known cost rather than disappearing
  or showing a guessed percentage. On a cold reconnect, Copilot may not report
  context until its system-prompt/tool metadata is initialized.

Accounting includes the main agent and subagents and refreshes at usage/idle
boundaries; it does not add event deltas together. Optional metadata failures do
not block chat, send a prompt or change configuration. No **Auto compact** label
is shown without a reliable reported setting. SDK/accounting and native visual
acceptance for these changes remain pending; new offline fixtures are unrun.

## Slash commands

Type `/` for commands discovered from your connected Copilot runtime, including
aliases. Where Copilot supplies argument hints or literal choices, suggestions
continue after the command name. Tab/click or Enter on a typed argument inserts
text only; it does not run the command. With an empty argument, Enter submits the
parent command unless you explicitly select an argument with the arrow keys.
Hints alone never prevent submission. Free-text arguments remain available;
dynamic argument and directory completion are not currently supported.

Slash commands belong to **Copilot**, not Nimrod's application actions. When a
command has no arguments and advertises argument choices, Nimrod first opens a
searchable command-palette-style picker. Use arrows and Enter to choose, or
Escape to cancel without invoking anything. This also works for command aliases
and whitespace-only arguments. Commands without advertised choices retain their
SDK default behavior; choices returned by an invocation can also open a picker.

For example, bare `/permissions` opens the picker when Copilot advertises its
permission operations. `/permissions show` bypasses the picker and displays the
returned report as labelled **Copilot command** output in the transcript, without
an assistant/model request. The installed CLI's post-fix behavior still needs
native verification.

Commands run while idle and consume the submitted draft immediately, without a
literal user-turn preview or forced transcript navigation. You can edit a newer
draft while waiting, but another submission waits until the command interaction
settles. Switching sessions, Stop or disconnect cancels pending choices; late
results never open a picker in another conversation or overwrite your draft.
Already executed effects are not rolled back. Command-output rows stay within
the current connection and are not restored on Close/Resume.

New commands work automatically when they use the supported SDK metadata and
result types: text/timeline output, completion, subcommand choices or an explicit
interactive agent-prompt result. Unknown commands are rejected with the draft
kept. Unsupported results report an error—never an ordinary prompt fallback or
automatic retry. Some model commands return host-side model/settings effects
that this SDK release does not publicly expose how to finalize; these remain
unsupported. Use **Select model…** in the command palette or the Status-area
model control for Nimrod's independent model picker. Scoped/model-enabling
requests, arbitrary new dialog kinds and autonomous modes are not supported.

Command discovery, argument suggestions and modal/output fixtures are authored
but unrun. This is not a claim of complete Copilot TUI command parity.

## History, Close and Delete

Nimrod remembers SDK session IDs, titles, recency, sidebar membership and separate
drafts; Copilot owns conversation history. Reopening a project reconnects the
last selected Copilot row automatically. Other restored rows stay disconnected
until selected. Reconnection uses the exact ID without sending a prompt or
continuing pending work.

After using built-in Copilot in a project, **Resume session… / ⌘/Ctrl+K** queries
project-owned SDK discovery alongside Pi. Discovery does not create/load a
conversation. Only exact project-directory, local sessions are included.
Refresh requests a fresh list; one unavailable source does not hide the others.
Selecting closed history immediately restores its SDK draft and then resumes
that exact ID. Missing/failed loads never create a replacement.

**Close** stops the owned connection and removes its sidebar entry, retaining
Copilot history and the SDK draft.

**Delete session…**, row/Project bar trash controls and **Delete sessions…** use
the SDK’s supported permanent deletion API. Review identifies one session and its
artifacts, not a Pi tree.
After confirmation Nimrod verifies fresh project membership, stops its owned
writer, and requests deletion. Only confirmed success removes local SDK
references/draft. Failed or uncertain results retain them and are never
automatically retried; use Refresh before a later explicit attempt. Nimrod does
not remove private Copilot directories or coordinate external applications.

## Earlier integration

The previous Copilot integration has been removed. Its saved sidebar entries are
no longer restored, and its project association no longer starts history discovery.
There is no automatic conversion or draft migration. Old stored drafts and
Copilot-owned history are not deleted. Start **New Copilot session** or use
Copilot's current project history through **Resume session**; older drafts are not
attached to newly opened sessions.
