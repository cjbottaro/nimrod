# Transcript debug logs

Enable **Transcript debug logs** in **Global Settings → Diagnostics** to capture the native conversation traffic Nimrod sends and receives on a **best-effort** basis. It is off by default; changing it does not restart agents, send prompts or fetch history. Existing enabled preferences are preserved.

## What is recorded

Pi (including extension tools), Codex and built-in Copilot logs include full prompts, responses, reasoning, tools, streaming fragments, errors, usage/configuration events, requests/replies, permission/question traffic and session UI actions. History delivered during normal connection/Resume or refresh is marked separately. Dormant ACP infrastructure uses the same logger. Unsent drafts, DOM snapshots and OS-wide activity are not collected; already-mounted conversation content is not backfilled.

**Logs can contain secrets, image bytes and other full conversation content.** They are neither redacted nor uploaded. Performance diagnostics are separate timing-only reports.

## Find and preserve logs

The resolved directory appears beside the setting. Nimrod honors an absolute `XDG_STATE_HOME`; by default:

```text
~/.local/state/nimrod/transcript-logs/
  pi/YYYY-MM-DD.jsonl
  pi/YYYY-MM-DD.000001.jsonl
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
  codex/codex/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Files roll over by **UTC day** and at a **25 MiB target**, adding numbered segments without splitting records. An individual event larger than that target stays whole in its own larger segment. Multiple windows/sessions may share files; identity fields distinguish them. Unsafe/long agent names are encoded in directory names and retained literally inside records.

While logging, successful writes prune oldest files to keep **at most 250 MiB across all sources**, also removing files last modified **seven or more days ago**. **Copy traces outside this directory to preserve them.** Pruning does not run while logging is off or the app is closed, and never affects harness history, unrelated files or the former `tool-captures/` directory. Turning logging off retains existing files.

## Read a trace

Give your coding assistant the source/day paths (including adjacent segments), approximate time and session ID if known. Records contain UTC receipt timestamps, segment-local sequence numbers, source/session/connection identities, an event name and the native JSON payload. A UI action or successful send reply alone is not proof of turn completion. Receipt time is not execution time; different windows have no shared total order. Enabling mid-turn can leave earlier events missing.

| Source | Event examples |
| --- | --- |
| Pi | `message_start`, `message_update`, `message_end`, `tool_execution_end`, `agent_settled`; outgoing `request.<type>`, replies `response.<command>` including normal history responses |
| Copilot | `assistant.message`, `assistant.reasoning_delta`, `tool.execution_complete`, `session.idle`; saved events `history.<native-type>`; `request.<method>`, `bridge.result`, full `permission.request` / `input.request` callback packets and `request.decision` answers |
| Codex | `receive` raw server records, outgoing `request` and `response` packets, plus `interaction.rejected` and local `connection.*` diagnostics. Connection/cleanup markers preserve failure causes and do not prove process exit. Inspect payload `method` and correlate RPC `id` with connection identity; history pages are correlated RPC replies, not separately labelled history events. Separate project catalogs use `catalog.*` events and catalog connection identities. |
| ACP | Native update names, `history.<name>` replay, `request.<method>`, JSON-RPC `response` and permission traffic |
| Nimrod | `ui.action` intent/error markers and `ui.configuration` local progress; neither proves harness acceptance |

Captured events are stored as whole JSONL records. Oversized events or bursts that exceed the bounded logging buffers may be omitted, never silently truncated. Sequence gaps indicate missing records when later records survive; leading/trailing loss may leave no on-disk indicator. Older logs may contain `capture.record_chunk` envelopes: group their payloads by `recordId`, require every index from zero through `count - 1`, concatenate `data` in index order, then JSON-parse the result to recover the original envelope. Incomplete old chunk sets mean missing diagnostic data, not complete events. Reconstruct those older records before filtering on native event/payload fields.

For ordinary or already-reconstructed records, filter a UTC window with:

```sh
jq -c 'select(.timestamp >= "2026-10-17T20:35:00.000Z" and .timestamp <= "2026-10-17T20:38:00.000Z")' \
  ~/.local/state/nimrod/transcript-logs/copilot-sdk/copilot/2026-10-17*.jsonl
```

## Failures and limitations

Logging is **fire-and-forget**, with bounded frontend snapshots and one native batched writer for appending, rotation and retention. Sessions never wait for diagnostic writes. Full buffers drop whole diagnostic records instead of delaying agent events, Send, decisions or Stop. Snapshot serialization still consumes some CPU/memory; best-effort does not mean zero overhead.

A warning and Diagnostics status report the capture's cumulative dropped-record count when loss is observed. **The capture is incomplete; session processing is unaffected.** The loss warning stays until a fresh capture starts. Logging can continue after overflow without toggling it; turning logging off/on starts a new segment and clears its loss count. An absent warning does not guarantee a complete trace.

Serialization or actual storage/retention failures stop logging in the affected window and show a separate error; native writer errors are reported asynchronously and never disconnect the session. Records are never silently truncated and ambiguous writes are not retried. Resolve the cause, then toggle logging off/on. Preserve and move aside a file with an incomplete final line before retrying; Nimrod never truncates it for you. Errors from older captures cannot stop a newer one.

Frontend buffering is limited to 4096 pending records / 16 Mi UTF-16 code units plus one in-flight batch. The native queue has 32 batch slots and a shared 64 MiB queued/active-write byte budget. Oversized diagnostic records are dropped whole. Native admission is not proof of persistence, and closing the app never waits for a diagnostic disk flush.

Pending events may be lost when logging is disabled, the window closes or the app crashes; this is a diagnostic trace, not a durable audit log. Best-effort logging, overflow reporting and unchanged rotation/retention still need native acceptance on macOS/Linux. Earlier tool-only logger checks do not establish acceptance of the current logger; Windows behavior remains unverified.
