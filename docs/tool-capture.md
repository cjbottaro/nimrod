# Transcript debug logs

Enable **Transcript debug logs** in **Global Settings → Diagnostics** to record the native conversation traffic Nimrod receives and sends. This replaces tool-only activity capture: one switch and one local JSONL pipeline for debugging transcripts, cards, streaming, configuration and lifecycle behavior.

It is off by default. The existing capture preference retains its value, so an already-enabled tool logger becomes the broader transcript logger. Pi (including extension tools) and built-in Copilot are supported; dormant ACP infrastructure uses the same pipeline but has no session-creation UI.

## What is collected

- User messages, assistant text and reasoning, including empty messages and streaming fragments.
- Tool generation, execution, output, results and original native metadata.
- Turn/activity boundaries, errors, usage and model/configuration events.
- Requests and replies for prompts, Stop, commands, configuration, permissions, questions and other session operations.
- History delivered during normal connection/Resume or existing history refreshes, distinguished from live events.
- Session-controller UI actions, including rejected submissions and render-error reports, plus local configuration-progress transitions.
- UTC receipt timestamps, sequence numbers, session/connection/capture identities, tool-call IDs when available and reported runtime versions when available.

**Logs contain full prompts, responses, reasoning, tool content, paths and possibly secrets.** They are not redacted or uploaded, and nothing is automatically deleted. Unsent draft edits, DOM snapshots, screenshots and OS-wide activity are not recorded. Performance diagnostics remain separate timing-only reports.

Enabling logging does not send prompts, load sessions, fetch history or restart agents. It records traffic from subsequent normal activity only; already-mounted transcript content is not retroactively copied. Logging a permission or a historical prompt never approves or executes it.

## Where logs go

The exact resolved directory appears beside the setting. Nimrod honors an absolute `XDG_STATE_HOME`; the default layout is:

```text
~/.local/state/nimrod/transcript-logs/
  pi/YYYY-MM-DD.jsonl
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Existing tool-only logs stay untouched under `~/.local/state/nimrod/tool-captures/`. They are not moved, rewritten or retroactively expanded. The setting's stored compatibility key remains `diagnostics.toolCapture`; it is still just one setting.

Files roll over by **UTC day** and are **append-only**. Multiple sessions/windows can share a source/day file; identity fields separate their records. Unix files are created privately. Unsafe/long agent directory names are encoded, with original identity retained in each record.

## Reading a trace

Give your coding assistant the source/day path, approximate UTC time and session ID if known. Native payloads retain their harness-specific shapes rather than becoming a universal conversation protocol.

- **Pi:** native event names such as `message_start`, `message_update`, `message_end`, `tool_execution_end` and `agent_settled`. Streaming updates include the full native `assistantMessageEvent.partial` and enclosing message snapshot. Outgoing RPCs use `request.<type>`; replies use `response.<command>`, including `response.get_messages` with saved history. Extension answers, timeouts and process errors are included.
- **Copilot:** native SDK event names such as `assistant.message`, `assistant.reasoning_delta`, `tool.execution_complete` and `session.idle`. Saved events use `history.<native-type>`. Empty content is retained. Duplicate native deliveries are logged before reducer deduplication. `request.<method>` records outgoing bridge requests; `bridge.result` contains correlated replies. `bridge.connected` records connection metadata without duplicating the history array. `permission.request` and `input.request` contain the complete callback packet, including its decision ID and original request. Decisions appear in `request.decision`.
- **ACP:** native session-update names such as `agent_message_chunk` and `tool_call_update`; replayed updates use `history.<name>`. Requests use `request.<method>`, replies use `response`, and incoming permission requests retain their JSON-RPC envelope. Loading-time inbound records have a `history.` prefix.
- **Nimrod:** `ui.action` is the session-controller action, not proof that it was sent or accepted. `ui.configuration` records changed local configuration operations, not authoritative harness settings.

Each line has the existing schema-version-1 capture envelope and a native JSON payload. For example:

```json
{"schemaVersion":1,"timestamp":"2026-10-17T20:36:05.000Z","captureId":"…","sequence":42,"source":{"backend":"copilot-sdk","agent":"copilot"},"sessionId":"…","connectionId":"…","event":"assistant.message","payload":{"id":"…","type":"assistant.message","data":{"messageId":"…","content":"","toolRequests":[{"toolCallId":"…","name":"view"}]}}}
```

Filter a time window with `jq`:

```sh
jq -c 'select(.timestamp >= "2026-10-17T20:35:00.000Z" and .timestamp <= "2026-10-17T20:38:00.000Z")' \
  ~/.local/state/nimrod/transcript-logs/copilot-sdk/copilot/2026-10-17.jsonl
```

Timestamps represent receipt/enqueue time, not original execution time. Sequence numbers order records within one capture segment; different windows do not share a total order, and wall clocks can move backwards. Before session identity is known, records use `connecting:…` or Pi's temporary identity; correlate through the stable connection ID. Runtime versions are present only after reported metadata becomes available. Enabling mid-turn can leave earlier events missing.

## Stopping, failures and limits

Turning logging off stops collection and retains existing files. Re-enabling starts a new segment without restarting agents. Pending undispatched events can be lost on disable, disposal or crash; already accepted writes may finish. This is a diagnostic trace, not a durable audit journal or replay tool.

Writes are buffered and never gate ordered session processing. Full content and cumulative snapshots add serialization/disk overhead and can grow logs substantially; use logging during development/debugging rather than as an indefinite archive.

Pending data is bounded to 8 Mi UTF-16 code units, with at most 2 Mi code units per record. Replay bursts are split into native batches of at most 512 records. An oversized event/history snapshot, buffer overflow, serialization error or write failure stops logging in that window and shows an application notice; records are not silently truncated and ambiguous writes are never retried. Resolve the cause, then toggle logging off/on. Preserve and move aside any file with an incomplete final line before retrying; Nimrod never truncates it for you.

Expanded transcript logging has authored offline fixtures but has not yet been test-run or accepted in the native app. Earlier tool-only capture had focused offline/native-storage evidence; that does not establish acceptance of the broader logger. macOS/Linux runtime behavior and Windows parity remain unverified.
