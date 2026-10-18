# Transcript debug logging

**Status: implemented.** This reference owns implementation contracts and fixture locations. [Verification](verification.md#transcript-logging) owns executed evidence and remaining acceptance gaps; [Transcript debug logs](../../../../docs/transcript-logs.md) owns user instructions and trace-reading examples. Related: [preferences](preferences.md), [error presentation](error-presentation.md), [consumer interfaces](consumer-interfaces.md).

## Boundary and settings

One opt-in full-content native trace serves Nimrod development/debugging, not playback, execution or a durable audit journal. Preserve harness payloads rather than inventing a universal conversation protocol. Record only normal traffic: no enabling-time history fetch, snapshot walk, unsent-draft subscription, DOM capture, prompt replay, permissions, navigation or harness-session mutation.

There is one sink per project/welcome window and one native append writer. Global Settings edits the switch but does not collect session traffic. `diagnostics.transcriptLogs` is a global-only boolean, default false. Preferences synchronize without restarting agents or recreating views.

The sole old-name setting alias is `diagnostics.toolCapture`: frontend and native readers fall back to it only when the new key is absent. Both keys are boolean-validated; explicit false on the new key wins. Reading never rewrites settings. An explicit logging toggle writes the new key and removes the alias in one existing compare-and-swap JSONC operation, preserving unrelated keys/comments and project settings. No old symbol, DOM-ID, IPC or module aliases remain.

## Sink and envelope

`TranscriptLogSink` exposes read-only `enabled` and synchronous, nonthrowing `append(TranscriptLogRecord): void`. Integrations supply backend/agent/optional reported version, session ID, optional connection/tool-call IDs, native event name and JSON payload. The sink snapshots before reducer/caller mutation, adds schemaVersion 1, receipt-time UTC timestamp, capture UUID and increasing sequence, then queues without awaiting disk. Disabled logging returns before serialization.

The existing JSONL schema is unchanged: `captureId` and `capture.record_chunk` identify trace segments/chunks, not the former feature. A connection UUID spans early identity discovery and final session identity. Early `connecting:<UUID>`/Pi temporary IDs are logging-only. Versions appear only when reported. Ordering is per capture segment; timestamps are receipt time, clocks may move backwards and windows have no shared total order. Logging remains independent of active/hidden painting; never materialize lazy history or serialize rendered rows on dirty updates. Configuration markers follow existing operation-array identity changes, not text deltas.

## Buffering, chunks and failures

- Enabling starts a fresh capture UUID/sequence. Disabling discards undispatched records; accepted writes may finish. Disposal dispatches an available tail best-effort. Queued/in-flight/crash tails may be lost; no fsync guarantee.
- Dispatch after ~100 ms, immediately at 512 pending records or 1 Mi UTF-16 code units, and immediately drain behind completed writes. Writes are serialized per sink. Pending data is bounded to 8 Mi UTF-16 code units, excluding the in-flight batch.
- Native batches allow 512 records/32 MiB and 8 MiB per line. Serialized envelopes above 2 Mi UTF-16 code units become lossless `capture.record_chunk` envelopes. Preserve original metadata/timestamp with increasing outer sequences and `{recordId,index,count,data}` payloads. `recordId` combines capture UUID/original sequence; each `data` slice is at most 128 Ki UTF-16 code units. Serialize the snapshot once. JSON escaping preserves surrogate splits. Chunks may interleave or span files/batches; incomplete sets are not complete events. Reconstruction instructions belong in the user guide.
- Serialization, overflow or storage/retention failure stops that window's logger and reports one application notice explicitly saying conversations are unaffected. Never silently truncate/sample or retry ambiguous writes. Overflow identifies buffer pressure. Toggle off/on to recover; retired-generation failures cannot stop a newer segment. Routine chunking, rotation and pruning are not errors.

## Concrete integration mapping

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

Rotate whole JSONL records at 25 MiB, continuing the highest canonical positive segment suffix (`.000001.jsonl`, etc.) for each source/day. Never rename/overwrite earlier segments. After each successful batch, prune oldest modification times (path breaks ties) to at most 250 MiB across sources and remove files last modified seven or more days ago. Scan only regular recognized dated/numbered files at source-directory depths; skip symlinks, unknown names and deeper directories. Unknown files do not count toward quota. Accepted batches may temporarily exceed it. No startup/off/idle pruning timer; harness histories are never candidates.

Unix files/directories are 0600/0700. Reject symlink/nonregular destinations, hard-linked or nonprivate Unix files; use no-follow/nonblocking opens and advisory exclusive locks. A private root `.writer.lock` serializes append/rotation/pruning across processes, alongside the app mutex/per-file locks. Recheck native opt-in at command acceptance and validate closed envelopes with arbitrary native JSON payloads. Incomplete final destination lines fail visibly without truncation; explicit preservation/move-aside is required. No guarantee against external path replacement. Windows lacks Unix permission/locking/no-follow guarantees; intended platforms versus verification are tracked separately.

Full prompts, reasoning, attachments, tool content and secrets may be recorded; no redaction, upload or automatic sharing. Timing-only performance reports remain separate.

## Code and fixture map

- `src/transcript-logs.ts`: sink/envelope, buffering, chunking, failure generations and disposal. `test/transcript-logs.test.ts` covers those paths plus native Pi events, history/RPC traces and >512-record replay.
- `src/pi/{transcript-logs,transport,session}.ts`, `src/copilot/session.ts`, `src/acp/session.ts`: concrete producers above. `test/copilot-transcript-logs.test.ts`, `copilot-bridge.test.ts`, `copilot-sdk.test.ts`, `acp-session.test.ts`: native payload fidelity, duplicate/history/empty/input events, disabled logging, mutation snapshots and early identity.
- `src/settings-surface.ts`, `index.html`, `src/main.ts`: control, notice routing and shared sink injection. `test/shell.test.ts`, `test/browser/demo-fixture.ts`: Settings-to-IPC integration/fixture transport.
- `src/preferences.ts`, `src-tauri/src/preferences.rs`: canonical setting/legacy fallback and validation. `test/preferences.test.ts` and native logging fixtures cover precedence, malformed values, read-only fallback, explicit-save migration, global scope and JSONC/source preservation.
- `src-tauri/src/transcript_logs.rs::tests`: private append, opt-in, incomplete tails, partitions, UTC rollover, concurrency, whole-record rotation, production limits, cross-source quota/age and excluded legacy/unknown/deep/symlink files.

Fixture locations are not evidence of execution; keep results and native acceptance gaps only in [verification](verification.md#transcript-logging).
