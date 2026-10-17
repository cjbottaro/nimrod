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

**Logs contain full prompts, responses, reasoning, tool content, paths and possibly secrets.** They are not redacted or uploaded. Diagnostic logs have automatic size/age retention; copy a trace outside the log directory if you need to keep it. Unsent draft edits, DOM snapshots, screenshots and OS-wide activity are not recorded. Performance diagnostics remain separate timing-only reports.

Enabling logging does not send prompts, load sessions, fetch history or restart agents. It records traffic from subsequent normal activity only; already-mounted transcript content is not retroactively copied. Logging a permission or a historical prompt never approves or executes it.

## Where logs go

The exact resolved directory appears beside the setting. Nimrod honors an absolute `XDG_STATE_HOME`; the default layout is:

```text
~/.local/state/nimrod/transcript-logs/
  pi/YYYY-MM-DD.jsonl
  pi/YYYY-MM-DD.000001.jsonl
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Existing tool-only logs stay untouched under `~/.local/state/nimrod/tool-captures/`. They are not moved, rewritten or retroactively expanded. The setting's stored compatibility key remains `diagnostics.toolCapture`; it is still just one setting.

Files roll over by **UTC day** and at **25 MiB**, adding numbered segments such as `.000001.jsonl`. Records are never split between files; existing file contents are not rewritten. Multiple sessions/windows can share a source/day file; identity fields separate their records. Unix files are created privately. Unsafe/long agent directory names are encoded, with original identity retained in each record.

After each successful batch, retention deletes the oldest diagnostic files to keep **at most 250 MiB across all sources** and removes files last modified **seven or more days ago**. Retention runs only while writes occur, not while logging is off or the app is closed. It covers existing daily transcript logs too, but never agent history, legacy `tool-captures/`, symlink targets or unrelated filenames. Routine rotation/retention does not show an application notice.

## Reading a trace

Give your coding assistant the source/day path, approximate UTC time and session ID if known. Native payloads retain their harness-specific shapes rather than becoming a universal conversation protocol.

- **Pi:** native event names such as `message_start`, `message_update`, `message_end`, `tool_execution_end` and `agent_settled`. Streaming updates include the full native `assistantMessageEvent.partial` and enclosing message snapshot. Outgoing RPCs use `request.<type>`; replies use `response.<command>`, including `response.get_messages` with saved history. Extension answers, timeouts and process errors are included.
- **Copilot:** native SDK event names such as `assistant.message`, `assistant.reasoning_delta`, `tool.execution_complete` and `session.idle`. Saved events use `history.<native-type>`. Empty content is retained. Duplicate native deliveries are logged before reducer deduplication. `request.<method>` records outgoing bridge requests; `bridge.result` contains correlated replies. `bridge.connected` records connection metadata without duplicating the history array. `permission.request` and `input.request` contain the complete callback packet, including its decision ID and original request. Decisions appear in `request.decision`.
- **ACP:** native session-update names such as `agent_message_chunk` and `tool_call_update`; replayed updates use `history.<name>`. Requests use `request.<method>`, replies use `response`, and incoming permission requests retain their JSON-RPC envelope. Loading-time inbound records have a `history.` prefix.
- **Nimrod:** `ui.action` is the session-controller action, not proof that it was sent or accepted. `ui.configuration` records changed local configuration operations, not authoritative harness settings.

Ordinary lines have the existing schema-version-1 capture envelope and a native JSON payload. For example:

```json
{"schemaVersion":1,"timestamp":"2026-10-17T20:36:05.000Z","captureId":"…","sequence":42,"source":{"backend":"copilot-sdk","agent":"copilot"},"sessionId":"…","connectionId":"…","event":"assistant.message","payload":{"id":"…","type":"assistant.message","data":{"messageId":"…","content":"","toolRequests":[{"toolCallId":"…","name":"view"}]}}}
```

An event whose serialized envelope exceeds 2 Mi characters is saved losslessly as multiple `capture.record_chunk` envelopes. Their payloads contain a shared `recordId`, zero-based `index`, total `count` and `data` string. Group chunks by `recordId`, require all indices from `0` through `count - 1`, concatenate `data` in index order, then JSON-parse it to recover the exact original envelope and native payload. Chunks can span batches/files and interleave with other windows. Incomplete sets indicate missing diagnostic data and must not be treated as complete events. No content is sampled or truncated.

Filter a time window with `jq` (include adjacent segments as needed, and reconstruct chunked events before filtering on native event/payload fields):

```sh
jq -c 'select(.timestamp >= "2026-10-17T20:35:00.000Z" and .timestamp <= "2026-10-17T20:38:00.000Z")' \
  ~/.local/state/nimrod/transcript-logs/copilot-sdk/copilot/2026-10-17.jsonl
```

Timestamps represent receipt/enqueue time, not original execution time. Sequence numbers order records within one capture segment; different windows do not share a total order, and wall clocks can move backwards. Before session identity is known, records use `connecting:…` or Pi's temporary identity; correlate through the stable connection ID. Runtime versions are present only after reported metadata becomes available. Enabling mid-turn can leave earlier events missing.

## Stopping, failures and limits

Turning logging off stops collection and retains existing files. Re-enabling starts a new segment without restarting agents. Pending undispatched events can be lost on disable, disposal or crash; already accepted writes may finish. This is a diagnostic trace, not a durable audit journal or replay tool.

Writes are buffered and never gate ordered session processing. Full content and cumulative snapshots add serialization/disk overhead; use logging during development/debugging rather than as an indefinite archive. Retention bounds stored diagnostic data, not serialization overhead.

Pending data is bounded to 8 Mi UTF-16 code units. Large events use the lossless chunks described above. Writes dispatch after about 100 ms or immediately at 512 queued records or 1 Mi queued characters. Subsequent batches drain without another debounce. A sustained burst can still exceed the bounded queue while storage is busy.

Buffer overflow, serialization errors and storage/retention failures stop logging in that window and show one application notice explicitly stating that the conversation is unaffected. Records are not silently truncated and ambiguous writes are never retried. A failure can leave an incomplete chunk set. Resolve the cause, then toggle logging off/on. Preserve and move aside any file with an incomplete final line before retrying; Nimrod never truncates it for you.

Expanded transcript logging, rotation/retention and chunking have authored offline fixtures but have not yet been test-run or accepted in the native app. Earlier tool-only capture had focused offline/native-storage evidence; that does not establish acceptance of the broader logger. macOS/Linux runtime behavior and Windows parity remain unverified.
