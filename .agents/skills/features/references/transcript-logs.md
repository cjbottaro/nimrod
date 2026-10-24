# Transcript debug logging

**Status: implemented.** This reference owns implementation contracts and fixture locations. [Verification](verification.md#transcript-logging) owns executed evidence and remaining acceptance gaps; [Transcript debug logs](../../../../docs/transcript-logs.md) owns user instructions and trace-reading examples. Related: [preferences](preferences.md), [error presentation](error-presentation.md), [consumer interfaces](consumer-interfaces.md).

## Boundary and settings

One opt-in full-content native trace serves Nimrod development/debugging, not playback, execution or a durable audit journal. Preserve harness payloads rather than inventing a universal conversation protocol. Record only normal traffic: no enabling-time history fetch, snapshot walk, unsent-draft subscription, DOM capture, prompt replay, permissions, navigation or harness-session mutation.

There is one sink per project/welcome window and one native append writer. Global Settings edits the switch but does not collect session traffic. `diagnostics.transcriptLogs` is a global-only boolean, default false. Preferences synchronize without restarting agents or recreating views.

The sole old-name setting alias is `diagnostics.toolCapture`: frontend and native readers fall back to it only when the new key is absent. Both keys are boolean-validated; explicit false on the new key wins. Reading never rewrites settings. An explicit logging toggle writes the new key and removes the alias in one existing compare-and-swap JSONC operation, preserving unrelated keys/comments and project settings. No old symbol, DOM-ID, IPC or module aliases remain.

## Sink and envelope

`TranscriptLogSink` exposes read-only `enabled`, synchronous nonthrowing `append(TranscriptLogRecord): void` without a persistence or flush prerequisite. Integrations supply backend/agent/optional reported version, session ID, optional connection/tool-call IDs, native event name and JSON payload. The sink snapshots before reducer/caller mutation, adds schemaVersion 1, receipt-time UTC timestamp, capture UUID and increasing sequence. Disabled logging returns before serialization.

The JSONL envelope schema is unchanged. New events remain whole records; legacy `capture.record_chunk` reading is documented in the guide. A connection UUID spans early identity discovery and final session identity. Early `connecting:<UUID>`/Pi temporary IDs are logging-only. Versions appear only when reported. Ordering is per capture segment; timestamps are receipt time, clocks may move backwards and windows have no shared total order. Logging remains independent of active/hidden painting; never materialize lazy history or serialize rendered rows on dirty updates. Configuration markers follow existing operation-array identity changes, not text deltas.

## Queue, best-effort delivery and failures

Logging is debugging/card-design instrumentation, not a durable audit journal.
**Session ingestion, request dispatch and native stdout delivery never await logging.**
No diagnostic delivery barriers, acknowledgements or slow-session warning remain.
Do not reintroduce no-drop flow control into the session path.

- Frontend `append` snapshots before caller mutation, then queues without awaiting IO. Disabled logging bypasses serialization. Synchronous serialization still has CPU/temporary-memory cost; fire-and-forget is not a claim of zero overhead.
- Each window retains at most **4096 pending records / 16 Mi UTF-16 code units** plus one in-flight batch. Overflow or a single record exceeding that character budget drops the whole diagnostic record, not session traffic. Attempted records still consume sequence numbers. Existing native payloads are never truncated, chunked, sampled or rewritten to fit.
- A **50 ms** timer batches across native packets, up to **512 records / 1 Mi code units** (one larger fitting record stays whole). One native admission IPC is in flight per window; pending snapshots stay bounded if IPC itself stalls. The explicit logger `flush()` exists only for diagnostic/test/disposal boundaries and means queue admission, not persistence/fsync. It is deliberately absent from the producer-facing `TranscriptLogSink` interface.
- One app-managed `TranscriptLogs` owns a **32-slot Tokio MPSC** and one named OS writer thread. Native admission uses `try_send`, never `reserve`, `send().await` or a disk receipt. An atomic **64 MiB** global byte budget includes accepted queued and active writes; RAII leases release bytes on write completion, dropped admission or error. Full slot/byte budgets return `{accepted:false}` immediately. The frontend counts that whole batch as dropped and never retries it. A larger buffer is not a reason to block a session.
- The native command returns at admission. Only the single writer parses/groups/appends/rotates/prunes and takes cross-process storage locks. Accepted jobs preserve FIFO admission order; source files retain their own capture/sequence identities. No thread/task is spawned per write. Filesystem/retention work and errors never become session failures.
- Frontend and native admission losses accumulate a **per-capture dropped-record count**, coalesced into one application warning and Settings status: capture is incomplete and session processing is unaffected. Sequence gaps reveal dropped records when later records survive; leading/trailing loss and shutdown tails may leave no on-disk indicator. The warning remains until a fresh capture, not merely until the buffer empties. No claim of complete logs follows from an absent warning.
- Writer errors arrive asynchronously through window-targeted `transcript-log-error` events with the originating capture UUID. The matching frontend logger stops and reports the existing diagnostic-only failure notice; stale-segment failures cannot stop a newer capture. Queue-closed/admission, serialization and native validation failures likewise affect logging only. Event-reporting failure goes to stderr. Nothing is automatically retried.
- Enabling starts a new UUID/sequence and resets loss/error notices. Disabling drops undispatched buffers; accepted native writes may finish. Disposal attempts an available batch best-effort without waiting for disk. Closing/crashing can lose pending/in-flight diagnostics; no fsync or shutdown-drain guarantee. Toggle off/on to recover from an actual capture failure.
- Native record/batch validation still enforces the envelope/storage safety checks. The 512 MiB parser limits are outer safety bounds, not a promise that a record that large will fit the smaller best-effort queue budgets.

## Concrete integration mapping

### Codex app-server

`src/codex/session.ts` captures raw incoming packets as `receive` before request/event dispatch, outgoing methods as `request`, and outgoing result/error packets as `response`. This includes experimental/unsupported interactions; `interaction.rejected` adds method/request-ID/reason correlation without replacing raw data. The project catalog uses corresponding `catalog.*` events and a distinct `catalog:<connection ID>` identity, including unsupported server requests. Source is `codex`/`codex`, with a connection ID and validated thread ID (or a connecting identity before binding). History pages remain correlated RPC responses, not separately replay-labelled events. Unknown notifications need not render a card to be captured. Logging remains opt-in, best-effort and full-content, with unchanged limits and no activation of runtime experiments. [Question contract/capture recipe](../../codex-integration/references/questions.md).

### Copilot SDK

`src/copilot/session.ts` logs every valid native event before reducer deduplication, including unknown events, duplicates and empty assistant messages. Normal connection history is logged as individual `history.<native-type>` events during synchronous replay, never as live work. The send closure records `request.<method>` before dispatch; incoming bridge packets use `bridge.<kind>` before correlation/application. `bridge.connected` omits its separately logged history array. Connection metadata follows authoritative identity validation; startup may use early IDs/version placeholders. Local teardown records `bridge.disconnected`.

`permission.request` and `input.request` retain full callback packets (kind, decision ID, original request); `request.decision` retains host decisions. Native permission lifecycle events remain separate observations. Tool-call correlation reads native `data`, callback `request` or nested `permissionRequest` without transforming payloads. `ui.action` and changed `ui.configuration` markers do not prove acceptance. Source is `copilot-sdk`/`copilot`, with reported SDK version; no credential/authentication transport capture.

### Pi

`src/pi/transcript-logs.ts::PiTranscriptLog` observes all native events, retaining complete message snapshots and `assistantMessageEvent.partial`, text/reasoning, tools, activity, extensions, queues, errors and compaction. Tool-call IDs are promoted directly or correlated through the assistant-local content-index map; no fabricated tool-result records.

`src/pi/transport.ts::onTrace` supplies `request.<type>`, `response.<command>` before pending-request lookup/application, extension replies and timeouts. Existing `get_messages` replies retain whole history, including normal post-compaction refreshes; logging never requests it. `process_error` follows existing disconnect publication. `src/pi/session.ts` binds current identity and UI/configuration markers without changing synchronous ordered application. Source is `pi`/`pi`.

### ACP

Dormant `src/acp/session.ts` logs native updates before projection/merging, including unknown updates. Loading updates use `history.<sessionUpdate>`; other inbound packets keep their JSON-RPC envelopes under the native method or `response`, prefixed `history.` during loading. Outgoing packets use `request.<method>`/`response`; teardown uses `connection.disconnected`. Permission callbacks are logged before enrichment/replay cancellation, not duplicated by the permission hook. UI markers retain the same diagnostic-only meaning. Source is `acp` plus negotiated agent name or `unknown`, with optional reported version and connection-scoped early identity. No ACP product UI is added.

## Native storage

`src-tauri/src/transcript_logs.rs` owns `append_transcript_logs` and `transcript_logs_directory`. Resolve the root under Nimrod's native state directory as `transcript-logs/`; [preferences](preferences.md#storage-and-synchronization) owns XDG/fallback behavior. Source and UTC receipt day determine subdirectories/filenames (see the guide). Backend/agent segments are native-derived; unsafe/long names use hashes while records retain original identities. Existing legacy `tool-captures/` files are never migrated, rewritten or pruned.

Rotate whole JSONL records at a 25 MiB target, continuing the highest canonical positive segment suffix (`.000001.jsonl`, etc.) for each source/day. A single larger native event occupies its own oversized segment rather than being chunked or rejected by the rotation target. Never rename/overwrite earlier segments. After each successful batch, prune oldest modification times (path breaks ties) to at most 250 MiB across sources and remove files last modified seven or more days ago. Scan only regular recognized dated/numbered files at source-directory depths; skip symlinks, unknown names and deeper directories. Unknown files do not count toward quota. Accepted batches may temporarily exceed it; even a newly written oversized segment participates in retention. No startup/off/idle pruning timer; harness histories are never candidates.

Unix files/directories are 0600/0700. Reject symlink/nonregular destinations, hard-linked or nonprivate Unix files; use no-follow/nonblocking opens and advisory exclusive locks. A private root `.writer.lock` serializes append/rotation/pruning across processes, alongside the app mutex/per-file locks. Recheck native opt-in at command acceptance and validate closed envelopes with arbitrary native JSON payloads. Incomplete final destination lines fail visibly without truncation; explicit preservation/move-aside is required. No guarantee against external path replacement. Windows lacks Unix permission/locking/no-follow guarantees; intended platforms versus verification are tracked separately.

Full prompts, reasoning, attachments, tool content and secrets may be recorded; no redaction, upload or automatic sharing. Timing-only performance reports remain separate.

## Code and fixture map

- `src/transcript-logs.ts`: bounded snapshots, timed batching, admission-only drain, loss counts, failure generations and disposal. `test/transcript-logs.test.ts` covers overflow/oversized drops, sequence gaps, rejected native admission, blocked diagnostic IO without blocking Pi requests/events, stale asynchronous writer errors, whole fitting events and no retry.
- Native `process::Output`, `main.ts` and concrete Pi/SDK/ACP writers: direct ordered session delivery, without logging wrappers or pre-send flushes. Native process and SDK transcript fixtures cover independent delivery/Send/Stop/decisions while diagnostic admission is blocked.
- `src/pi/{transcript-logs,transport,session}.ts`, `src/copilot/session.ts`, `src/codex/session.ts`, `src/acp/session.ts`: concrete producers above. `test/copilot-transcript-logs.test.ts`, `copilot-bridge.test.ts`, `copilot-sdk.test.ts`, `acp-session.test.ts`: native payload fidelity, duplicate/history/empty/input events, disabled logging, mutation snapshots and early identity.
- `src/settings-surface.ts`, `index.html`, `src/main.ts`: control, notice routing and shared sink injection. `test/shell.test.ts`, `test/browser/demo-fixture.ts`: Settings-to-IPC integration/fixture transport.
- `src/preferences.ts`, `src-tauri/src/preferences.rs`: canonical setting/legacy fallback and validation. `test/preferences.test.ts` and native logging fixtures cover precedence, malformed values, read-only fallback, explicit-save migration, global scope and JSONC/source preservation.
- `src-tauri/src/transcript_logs.rs::tests`: nonblocking full-queue/byte-budget rejection, active-write accounting, accepted FIFO order, asynchronous error continuation/no retry, plus existing private append, opt-in, incomplete tails, partitions, UTC rollover, concurrency, rotation, quota/age and excluded legacy/unknown/deep/symlink fixtures.

Fixture locations are not evidence of execution; keep results and native acceptance gaps only in [verification](verification.md#transcript-logging).
