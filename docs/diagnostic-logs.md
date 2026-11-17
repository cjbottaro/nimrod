# Diagnostic logs

Diagnostic logs record Nimrod's connection/configuration decisions separately
from [full-content transcript logs](transcript-logs.md) and
[timing-only performance reports](performance-diagnostics.md). They are off by
default. The initial instrumentation covers **Copilot** connections and context
window reporting; it is not a general application console or a trace of every
harness.

## Capture a Copilot Resume

1. Open **global Settings → Diagnostics** and enable **Diagnostic logs**.
2. Return to the project and explicitly **Resume** an affected Copilot session.
   For an already-connected session, use **Reload session** if idle.
3. Wait until it is connected and note the window displayed in the Status area.
   **You do not need to send a prompt.**
4. Open the log directory shown in Settings and inspect the newest Copilot JSONL
   file. Group records by `connectionId` to isolate that Resume.
5. Disable Diagnostic logs when finished. Existing files are retained subject to
   the retention limits below.

Enabling the switch does not open/resume a session, fetch history or issue any
metadata request. It observes future normal traffic. A fresh Resume/Reload is
needed to capture the complete startup sequence. Changes propagate to project
windows without restarting Nimrod. Turning the switch off immediately stops
frontend capture; the bridge learns the current setting with its next ordinary
request. No extra request is sent just to toggle logging.

## Reading a capture

Every record has a receipt timestamp, `captureId`, increasing `sequence`,
`connectionId`, session identity and an event name. Startup records can have a
`connecting:…` identity before Copilot returns the saved ID. The same
`connectionId` connects them to later records. `captureId` is window/log-segment
scoped, not a harness session ID.

| Event | Meaning |
| --- | --- |
| `runtime.start` | Resolved Copilot executable path and Node version. |
| `runtime.status` | Copilot-reported runtime and protocol versions. |
| `session.connect.requested` | Create/Resume intent, request ID, exact saved ID when resuming, and recovery/continuation flags. |
| `session.connect.completed` | The identity returned by SDK create/Resume. It does not imply all later configuration/history reads succeeded. |
| `configuration.defaults` | Relevant model/effort/context defaults for creation only. Resume does not reapply these defaults. |
| `model.snapshot` | `raw` public `model.getCurrent()` fields and Nimrod's `resolved` snapshot after creation-default fallback. This is not a dump of the SDK's private wire traffic. |
| `model.catalog` | Whether the selected model was in the existing catalog, plus its advertised prompt/output/combined and tier-specific prompt budgets. No pricing, credentials or full catalog dump. |
| `context.metadata` | Whether the context result contains `contextInfo`, and its numeric token/window fields or explicit `null`. |
| `display.context` | Nimrod's selected model, reported tier, reported/advertised limits and display source. |
| `operation.failed` | Which startup/configuration/context operation failed; error messages, stacks and provider responses are deliberately omitted. |

An **omitted** property remains omitted; an explicit **`null`** remains null.
For example, `model.snapshot.raw` can omit `contextTier` while the display source
is `catalog-standard-preview`. A later `reported` source means actual context
metadata replaced the estimate; it does not by itself prove a tier switch.
`catalog-reported-tier` means the catalog budget for a reported tier, not a
measured session window. `unknown` means neither source is usable at that point.
Display decisions are recorded only when their relevant metadata changes, not on
every streamed text chunk.

## Storage and privacy

Default location:

```text
~/.local/state/nimrod/diagnostic-logs/copilot-sdk/copilot/YYYY-MM-DD.jsonl
```

An absolute `XDG_STATE_HOME` changes the state root. Settings shows the resolved
location. These files are local and are never uploaded automatically.

Diagnostic records include **session IDs, executable paths, model IDs and
numeric metadata**. Copilot producers use explicit field allowlists: prompts,
assistant text/reasoning, tool contents, attachments, credentials and arbitrary
SDK/error payloads are not included. Transcript logging is independent and can
still record full content when separately enabled.

The existing bounded log writer is shared, but diagnostic files, capture IDs,
errors and retention are separate from transcript logs. Files rotate at 25 MiB,
with at most 250 MiB and seven days retained per stream. Writes never gate chat;
full buffers drop records and report an incomplete capture. Files may be missing
records around overload, shutdown or failures; this is not a durable audit log.
Unix files/directories use private permissions; native Linux delivery and
Windows filesystem behavior have not been accepted from macOS-only work.

No diagnostic record is read back as session state. Copilot remains authoritative
for saved configuration, context tier and the effective window.
