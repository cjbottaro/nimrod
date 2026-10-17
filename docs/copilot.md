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
unbound by default. Ordinary **New session** and **⌘/Ctrl+N** still create Pi
sessions, regardless of the selected harness.

Text Send clears the composer and previews your turn immediately. It never
replays uncertain delivery or restores sent text over a newer draft. While
working, Enter keeps your draft; there is no steering/queue. **Stop** cancels the
turn, not the saved conversation. A failed connection retains its row and draft;
fix the executable/authentication issue, then reconnect explicitly.

Permission requests and questions stay inside their own conversation. Review
literal operation details and choose **Allow once**, **Deny**, an offered answer
or freeform text when supported. **Cancel request** never approves. A background
request does not switch sessions or steal focus; return to its conversation to
act. Stop/Close/disconnect cancel pending choices.

Model and thinking controls use Copilot’s reported catalog and current state,
and are available while idle. Thinking appears only for a model that advertises
efforts. Tool/reasoning cards, disclosures, scroll behavior, draft storage and
notification preferences reuse the existing shell. Unknown rich results remain
literal data; no tool payload grants additional permission.

Current limits: text-only input; no CLI slash-command emulation, Restart,
steering, queue, Pi MCP inspector or in-place harness switching.
Only interactive Copilot sessions are supported. Plan/autopilot histories remain
listed, but connection reports their unsupported mode without changing it or
sending a prompt; change the mode in Copilot before reconnecting. Custom ACP
agents remain a [separate experimental option](acp.md).

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
the SDK’s supported permanent deletion API, **not ACP’s optional deletion
capability**. Review identifies one session and its artifacts, not a Pi tree.
After confirmation Nimrod verifies fresh project membership, stops its owned
writer, and requests deletion. Only confirmed success removes local SDK
references/draft. Failed or uncertain results retain them and are never
automatically retried; use Refresh before a later explicit attempt. Nimrod does
not remove private Copilot directories or coordinate external applications.

## Older Copilot ACP entries

Previously saved **Copilot (legacy ACP)** entries keep their exact ACP identity
and separate draft; they are not automatically migrated to the SDK. Selecting
one still uses the legacy ACP load path and advertised capabilities. CLI
1.0.98 does not advertise ACP deletion, so that legacy entry’s Delete remains
unavailable even though SDK-native entries have supported SDK deletion.

The same ID may be discovered by both transports. Nimrod will not reinterpret
drafts or control it concurrently: close the conflicting entry before connecting
the other representation. Closing keeps its separate draft. Deleting an SDK
session does not erase its legacy ACP draft or establish interchangeability.
No seamless ACP/SDK switching is promised.
