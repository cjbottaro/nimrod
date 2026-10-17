# Tool activity logs

Enable **Capture tool activity** in **Global Settings → Diagnostics** to automatically collect local JSON Lines logs for card/plugin development. It is off by default and covers both **Pi, including extension tools**, and **ACP agents such as Copilot**.

No manual inspection/capture action is needed. Enable it, work normally, then give your coding assistant the relevant log paths and time window to inventory tool payloads and develop bespoke cards.

## What is collected

- Tool starts, partial input/progress updates and results, with structured native payloads.
- ACP tool-call patches and live permission-request tool details/options.
- UTC receipt timestamps, sequence numbers, capture/session/connection identity, tool-call IDs when available, backend and agent identity, and reported agent versions when available.

Pi and ACP retain their native event names and payload shapes; tools do not have to be known to Nimrod in advance. Pi generation events omit their full assistant-message `partial` snapshot, retaining only tool-event data. Normal prompts, assistant prose, reasoning streams and saved-history replay are not collected.

**Tool payloads themselves can contain source code, commands, outputs, secrets, or embedded prompt/reasoning text.** Logs are not redacted or uploaded. Share them only deliberately.

## Where logs go

The exact resolved directory is shown beside the setting. Logs use Nimrod's existing state directory, like performance captures, honoring an absolute `XDG_STATE_HOME`. The default layout is:

```text
~/.local/state/nimrod/tool-captures/
  pi/2026-10-16.jsonl
  acp/copilot/2026-10-16.jsonl
  acp/<other-agent>/2026-10-16.jsonl
```

Agent directory names come from reported identity, not display titles. Unsafe/long names receive a hash-based directory name; their original names are retained inside records.

Files roll over by **UTC day** and are **append-only**. Multiple sessions/windows can contribute to the same source/day file, with identity fields separating their events. Existing logs are never automatically deleted, truncated or rewritten. Unix files are created with private permissions.

## Inspecting a time window

Each line is an independent JSON object. For example:

```json
{"schemaVersion":1,"timestamp":"2026-10-16T19:42:31.482Z","captureId":"…","sequence":42,"source":{"backend":"acp","agent":"copilot"},"sessionId":"…","connectionId":"…","toolCallId":"…","event":"tool_call_update","payload":{"sessionUpdate":"tool_call_update","toolCallId":"…","status":"completed"}}
```

With `jq`, select activity around a particular UTC time:

```sh
jq -c 'select(.timestamp >= "2026-10-16T19:40:00.000Z" and .timestamp <= "2026-10-16T19:45:00.000Z")' \
  ~/.local/state/nimrod/tool-captures/acp/copilot/2026-10-16.jsonl
```

For local times, convert to UTC first. Timestamps are when Nimrod receives events, not necessarily when a tool starts executing. Sequence numbers order records within one capture segment; wall clocks can move backwards, and multiple windows do not share a total sequence. Capture starting mid-tool may lack earlier inputs or a tool ID. Connection IDs and Pi's message sequence/content index help correlate partial events.

## Stopping, failures and limits

Turning capture off stops collecting new events; logs remain on disk. Enabling it again starts a new capture segment without restarting agents. It does not retroactively log existing cards or saved history.

Logging is buffered and does not wait for disk before processing agent events. Pending events may be lost on disable, close or crash; already accepted writes may finish after disable. Capture adds serialization/disk overhead, so leave it off outside discovery/debugging work.

A buffer overflow, oversized payload or write failure stops capture in the affected window and shows an application notice. Records are not silently truncated, and ambiguous writes are never retried automatically. Resolve the cause, then toggle capture off and on. If a file has an incomplete final record after a crash/write failure, preserve it and move it aside before retrying; Nimrod will not truncate it for you.

This is a diagnostic aid, not a durable audit log. The implementation and offline fixtures have not yet been validated for this feature. Actual macOS/Linux collection and multi-process behavior remain to be verified; Windows parity is not established. [Performance reports](performance-diagnostics.md) remain separate, timing-only captures with their own retention policy.
