# Transcript debug logs

Enable **Transcript debug logs** in **Global Settings → Diagnostics** to record the native conversation traffic Nimrod sends and receives. It is off by default; changing it does not restart agents, send prompts or fetch history. Existing enabled preferences are preserved.

## What is recorded

Pi (including extension tools) and built-in Copilot logs include full prompts, responses, reasoning, tools, streaming fragments, errors, usage/configuration events, requests/replies, permission/question traffic and session UI actions. History delivered during normal connection/Resume or refresh is marked separately. Dormant ACP infrastructure uses the same logger. Unsent drafts, DOM snapshots and OS-wide activity are not collected; already-mounted conversation content is not backfilled.

**Logs can contain secrets, image bytes and other full conversation content.** They are neither redacted nor uploaded. Performance diagnostics are separate timing-only reports.

## Find and preserve logs

The resolved directory appears beside the setting. Nimrod honors an absolute `XDG_STATE_HOME`; by default:

```text
~/.local/state/nimrod/transcript-logs/
  pi/YYYY-MM-DD.jsonl
  pi/YYYY-MM-DD.000001.jsonl
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
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
| ACP | Native update names, `history.<name>` replay, `request.<method>`, JSON-RPC `response` and permission traffic |
| Nimrod | `ui.action` intent/error markers and `ui.configuration` local progress; neither proves harness acceptance |

New events are stored as whole JSONL records, including large history snapshots. Older logs may contain `capture.record_chunk` envelopes: group their payloads by `recordId`, require every index from zero through `count - 1`, concatenate `data` in index order, then JSON-parse the result to recover the original envelope. Incomplete old chunk sets mean missing diagnostic data, not complete events. Reconstruct those older records before filtering on native event/payload fields.

For ordinary or already-reconstructed records, filter a UTC window with:

```sh
jq -c 'select(.timestamp >= "2026-10-17T20:35:00.000Z" and .timestamp <= "2026-10-17T20:38:00.000Z")' \
  ~/.local/state/nimrod/transcript-logs/copilot-sdk/copilot/2026-10-17*.jsonl
```

## Failures and limitations

One native writer consumes a bounded shared queue and handles appending, rotation and retention. When it falls behind, producers wait rather than dropping records or stopping logging. **This opt-in development tool can slow session processing.** The UI thread does not block, and disabling logging restores normal ingestion after already accepted writes finish.

If a producer waits **at least one second** for queue capacity or the writer, one application warning says **“Transcript logging is catching up. Session processing may be slower while debug logging is enabled.”** Brief waits show nothing. The warning clears automatically when all prolonged waits finish; logging continues without an off/on toggle.

Serialization or actual storage/retention failures still stop logging in the affected window and show a separate error. Records are never silently truncated and ambiguous writes are not retried. Resolve the cause, then toggle logging off/on. Preserve and move aside a file with an incomplete final line before retrying; Nimrod never truncates it for you.

Pending events may be lost when logging is disabled, the window closes or the app crashes; this is a diagnostic trace, not a durable audit log. Full-content snapshots add serialization/memory/disk overhead. Native logging ingress retains a 512 MiB record/batch safety limit; an event exceeding it fails explicitly instead of being truncated.

Expanded logging, rotation and backpressure still need native acceptance on macOS/Linux. Earlier tool-only logger checks do not establish acceptance of the current logger; Windows behavior remains unverified.
