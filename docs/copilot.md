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

Permission requests and questions stay inside their own conversation. Shell requests show **Run command · intention** and the exact command; file requests show project-relative paths (absolute outside the project), and URL requests show **Fetch · URL**. Supplied changes/arguments and sandbox-bypass requirements stay visible; **Raw details** is collapsed beneath the buttons. Unknown scopes retain literal details. Choose **Allow once**, **Deny**, an offered answer
or freeform text when supported. **Cancel request** never approves. A background
request does not switch sessions or steal focus; return to its conversation to
act. Stop/Close/disconnect cancel pending choices.

Model and thinking controls use Copilot’s reported catalog and current state,
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
Only interactive Copilot sessions are supported. Plan/autopilot histories remain
listed, but connection reports their unsupported mode without changing it or
sending a prompt; change the mode in Copilot before reconnecting. Generic agent
protocol infrastructure is retained internally, without a separate creation action.

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
drafts; Copilot owns conversation history. Reopening a project **does not resume
conversations automatically**. Selecting an inactive row reconnects its exact ID
without sending a prompt or continuing pending work.

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
