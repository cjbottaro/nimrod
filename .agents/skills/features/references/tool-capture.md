# Transcript debug logging

**Status: implemented source; expanded-logging fixtures authored but unrun.** User guide: [Transcript debug logs](../../../../docs/tool-capture.md). Related: [Copilot SDK](copilot-sdk.md), [preferences](preferences.md), [consumer interfaces](consumer-interfaces.md), [performance diagnostics](performance-diagnostics.md), [card plugins](card-plugins.md).

## Purpose and boundary

One opt-in full-content native transcript trace replaces the former tool-only capture. Its consumer is Nimrod development/debugging: reconstruct conversation inputs, streaming boundaries, empty envelopes, tool lifecycle, configuration, permission/input decisions, history and failures; derive offline regression fixtures and bespoke cards. It is not a universal harness protocol, playback/execution API or durable audit journal.

The existing `src/tool-capture.ts` / `ToolCaptureSink` / `ToolCaptureRecord` identifiers, injected `toolCapture` property, native command names and `diagnostics.toolCapture` preference are retained as compatibility plumbing, not separate logging products. The setting's prior boolean value remains effective. There is one switch, one sink per project/welcome window and one native append writer. Global Settings edits the switch but does not collect session traffic. Project settings cannot override it; default is false.

Native integrations retain authority and payload shapes. Logging cannot approve, send/replay, load, discover, reconnect, navigate or change drafts, disclosures, scroll/focus or notifications. It records only traffic already processed by normal session work. No enabling-time snapshot walk/history fetch, DOM capture or unsent-draft subscription. Already-loaded transcript data is not backfilled. Historical input is diagnostic data, never executable intent.

## Port and envelope

The minimum port remains a read-only `enabled` flag and synchronous, nonthrowing `append(ToolCaptureRecord): void`. Integrations supply source backend/agent/optional reported version, session ID, optional stable connection/tool-call IDs, event name and native JSON payload. The sink snapshots synchronously before reducers or caller mutation, adds schemaVersion 1, receipt-time UTC RFC3339 timestamp, per-segment capture UUID and increasing sequence, then queues without awaiting disk. The sink/storage never parse conversation/tool schemas.

One connection UUID spans early identity discovery and final session identity. Early records use `connecting:<connection UUID>` or Pi's temporary runtime ID; these are logging-only values and never saved identities or SDK parameters. Version metadata appears only after actually reported; Pi does not invent a version. Ordering is capture-segment-local, not globally monotonic across windows/files. Receipt clocks can move backwards. Original native timestamps/IDs remain in payloads. Native event names remain literal; `history.`, `request.`, `response.`, `bridge.` and `ui.` prefixes identify source/lifecycle boundaries, not normalized harness events.

## Setting, buffering and failure lifecycle

- **Global Settings → Diagnostics → Transcript debug logs** is off by default. Preferences synchronize without agent restart/view recreation. Existing tool-capture opt-in becomes broader full-content logging, documented beside the control and in the guide.
- Disabled capture does not serialize payloads or inspect history; integration bookkeeping already required by semantic processing may still run. Enabled capture is payload-size-proportional, including native cumulative snapshots; this is deliberate diagnostics overhead, not a performance optimization.
- Enabling starts a fresh capture UUID/sequence; disabling discards undispatched data. Accepted writes may finish. Disposal dispatches one available tail best-effort; queued/in-flight/process-crash tails may be lost. No fsync/durable-audit guarantee.
- Writes dispatch after approximately 100 ms, or immediately at 512 pending records or 1 Mi queued UTF-16 code units. After a write completes, queued batches drain immediately without another debounce, serialized per sink. Pending data remains bounded to 8 Mi UTF-16 code units, excluding the single in-flight batch; sustained bursts while storage is busy can still overflow. No silent sampling/truncation.
- Native validation retains 512 records/32 MiB per batch and 8 MiB per line. Serialized envelopes above 2 Mi UTF-16 code units become lossless `capture.record_chunk` envelopes: original source/session/connection/tool metadata and timestamp, distinct increasing outer sequences, payload `{recordId,index,count,data}`. `recordId` combines capture UUID and original sequence; `data` is a 128 Ki-code-unit slice of the exact serialized original envelope. Snapshot serialization occurs once before chunking, not once per piece. Group by record ID, require every zero-based index and matching count, concatenate data, JSON-parse to recover the exact native event/envelope. JSON string escaping preserves even surrogate-pair splits. Chunk sets may span native batches/files or be incomplete after failures/disable/crashes; never infer a complete native event from an incomplete set. Ordinary envelopes retain their existing format.
- Serialization, overflow or storage/retention failure stops that window's logger and reports one shared application notice explicitly saying the conversation is unaffected. Record chunking and routine rotation/pruning are not errors. Overflow wording distinguishes pending-buffer pressure. Toggle off/on for a new segment; never retry ambiguous writes, including partially accepted chunk sets. Late failures from a retired segment cannot stop a new one. Logging failure cannot change session semantics.
- Session events are recorded independently of active/hidden transcript painting. No new transcript projection/cache or history scan on dirty tool-output updates. Local configuration operations are logged only on existing operation-array identity changes, not every text delta.

## Concrete integration mapping

### Copilot SDK

`src/copilot/session.ts::event` captures every valid native event **before reducer deduplication**, with exact original event object including ID, timestamp, parent/agent identities and data. Thus duplicate deliveries and empty `assistant.message` content/toolRequests are inspectable. Unrecognized future events are recorded even if not projected into the transcript. Saved `connected.events` are logged individually as `history.<native-type>` during the existing synchronous replay, never treated as live work or notifications.

Outgoing bridge requests are logged by the existing send closure as `request.<method>`, preserving request IDs, prompt/configuration/command/decision parameters. Incoming results, fatal records, identities and catalogs use `bridge.<kind>` before correlation/application. `bridge.connected` contains connection metadata without its events array, which is already logged event-by-event. Metadata is captured after validating/publishing the authoritative session identity; initialization traffic may use early identity/version placeholders. `bridge.disconnected` records local/transport teardown reasons.

Permission/input callbacks use `permission.request` / `input.request` with the **full callback packet** (kind, decision ID, original request). This deliberately replaces the old permission-only request payload; native permission lifecycle events remain separate actual SDK observations. `request.decision` retains the returned host decision. Envelope tool-call correlation reads native `data`, callback `request` or nested `permissionRequest` without changing payloads. `ui.action` captures controller actions (including rejected requests/render errors); `ui.configuration` captures changed local operation arrays. Neither implies harness acceptance.

Source is `copilot-sdk`/`copilot`; version comes from existing SDK status metadata. No raw SDK authentication transport, credential discovery or upstream extension changes.

### Pi

`src/pi/tool-capture.ts::PiToolCapture.observe` now forwards **all native events**, not a tool allowlist: user/assistant message starts/updates/ends, text/reasoning/tool generation, execution, results, activity/turns, extension UI, queues, errors and compaction. Exact event snapshots include full `assistantMessageEvent.partial` and outer message data; no prose/reasoning stripping or synthetic extracted tool-result records. Tool-call IDs are promoted when present or correlated through the existing assistant-local content-index map; original identifiers remain in native payloads.

`src/pi/transport.ts::onTrace` supplies outgoing `request.<type>`, incoming `response.<command>` **before pending-request lookup/application**, extension UI replies and request timeouts. Existing `get_messages` responses retain history as one exact native response, including post-compaction refreshes; logging never requests extra history. `process_error` uses existing disconnect event publication. `src/pi/session.ts` binds the trace to the shared sink/current session identity and records `ui.action` and changed `ui.configuration` operations. Ordered synchronous state/history application remains unchanged. Source is `pi`/`pi`.

### ACP

Dormant `src/acp/session.ts` records all session updates before projection/merging, including user/assistant/thought chunks, tools, config, plans, usage and unknown future update types. Loading-phase updates use `history.<sessionUpdate>`; they remain read-only replay under ACP lifecycle semantics. Non-update inbound records retain their full JSON-RPC packets under the native method or `response`, with `history.` during load. Outgoing packets use `request.<method>` or `response` (including permission choices), and disconnect reasons use `connection.disconnected`. Controller actions/local configuration operations use the same explicit `ui.*` diagnostic names.

Native permission requests are logged at receive, before enrichment or replay cancellation, not duplicated by the permission hook. Source is `acp` plus negotiated agent name or `unknown`; reported agent versions remain optional. Early initialization packets correlate by connection UUID until identity is known. No ACP creation/options UI is added.

## Storage and compatibility

New logs use the native resolved state directory (absolute XDG_STATE_HOME or existing portable fallback):

```text
~/.local/state/nimrod/transcript-logs/
  pi/YYYY-MM-DD.jsonl
  pi/YYYY-MM-DD.000001.jsonl
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Former `tool-captures/` files are left untouched—no migration, truncation, pruning or expansion. Settings shows the new exact root even while disabled. Existing doc/module/IPC/preference names containing tool-capture are compatibility names; the current feature is transcript debug logging.

Backend/agent segments are derived natively, never frontend-supplied paths. Ordinary alphanumeric/hyphen/underscore names remain readable; unsafe/long names use hash-derived segments and retain original identity in records. Files partition by receipt timestamp normalized to UTC, not modification time. Interleaved sessions/windows remain distinguishable through envelope IDs.

Files rotate at 25 MiB on whole JSONL records, using canonical positive numbered suffixes (`.000001.jsonl`, etc.) within each source/UTC-day directory. Later batches continue the highest existing segment; prior files are never renamed, overwritten or truncated. Oversized existing daily files rotate on the next append. After each successful append batch, native retention scans only regular dated/numbered JSONL files within backend/agent directory depths, skips symlinks and deeper/unrecognized paths, and deletes oldest modification times first until at most 250 MiB remain across all sources. Files last modified at least seven days ago are also removed. Age uses filesystem modification time, not recorded event time; ties use path order. Existing daily transcript logs participate; `tool-captures/` and harness histories never do. Unknown files do not count toward the managed-log quota. The accepted batch may temporarily exceed the quota before pruning. No idle/off/startup cleanup timer or automatic notices for normal retention. Copy traces outside the managed directory for preservation.

Files are created 0600 and directories 0700 on Unix. The writer rejects symlink/nonregular destinations and nonprivate/hard-linked Unix files; Unix opens use no-follow/nonblocking flags and advisory exclusive locks. A private `.writer.lock` serializes append/rotation/pruning across Nimrod processes on Unix, in addition to the app-wide worker mutex and per-file locks. Retention refuses nonprivate/hard-linked managed Unix files. Workers validate closed envelope fields while accepting arbitrary native JSON payloads. Opt-in is rechecked natively at command acceptance. Existing incomplete final lines in the destination segment fail visibly without modifying/truncating that file; preserve/move them aside explicitly before retry. Windows lacks Unix permission/locking/no-follow guarantees and is not a current parity commitment. No exclusion guarantee against external tools replacing paths.

Full prompts, answers, reasoning, attachments in native payloads, source, commands, paths, outputs and secrets can be recorded. No silent redaction/upload/automatic sharing or harness-session mutation. Automatic deletion applies only to managed transcript diagnostics as specified above. Timing-only performance reports keep their separate purpose/retention.

## Code map and verification

- `src/tool-capture.ts`: shared sink/envelope/buffering/generation/failure/disposal; early dispatch and immediate tail draining, plus reconstructable oversized-event chunks.
- `src/pi/{tool-capture,transport,session}.ts`: all native Pi event capture, RPC trace hook, controller actions/configuration progress and session identity.
- `src/copilot/session.ts`: native/history/duplicate events, bridge requests/results/decisions, early identity/version and UI markers.
- `src/acp/session.ts`: native updates, replay tags, JSON-RPC exchanges, UI markers and disconnect.
- `src/settings-surface.ts`, `index.html`, `src/preferences.ts`, `src/main.ts`: renamed single setting, compatibility key, shared sink injection and notice routing.
- `src-tauri/src/tool_capture.rs`: unchanged command names/root and private append validation; whole-record size rotation, root-wide Unix locking and cross-source age/size retention.

Rotation/retention and burst/chunk fixtures are authored **but unrun**. Sink fixtures cover early byte/count dispatch, immediate draining behind an in-flight batch, explicit sustained overflow, exact reconstruction of oversized escaped/Unicode payloads, increasing post-chunk sequences and immediate chunking stop after synchronous storage failure. Native fixtures use small injected limits to assert exact size boundaries, unchanged whole records, continuation numbering, concurrent rotation, cross-source oldest-first quota/age boundaries and preservation of legacy/unrecognized/deep/symlink paths. Constants assert the production 25/250 MiB limits. No live log pruning, app launch or native acceptance was performed.

Expanded fixtures are authored **but unrun**: `test/tool-capture.test.ts` covers full native Pi text/reasoning, correlated generation, history RPC/extension replies/disconnect and >512-record replay batching; `test/copilot-tool-capture.test.ts` covers exact tool/native events, duplicate delivery, empty tool-only assistant history, prose/reasoning/input decisions, disabled collection, mutation snapshots and early identity; `test/copilot-bridge.test.ts`, `test/copilot-sdk.test.ts`, `test/acp-session.test.ts`, `test/shell.test.ts` and browser fixture paths are updated for expanded capture. Existing sink failure/overflow/nonretry/retired-generation fixtures remain relevant. The native fixture now asserts the new resolved directory suffix; existing permission/append/partition/lock/tail/symlink guarantees remain unchanged.

Earlier **tool-only** capture evidence: 13 focused controller/production-bridge/sink Node tests and six native storage fixtures passed. Its full `mise run test` passed TypeScript/docs then stopped on four unrelated stale migration assertions (918/922 Node tests); later Rust formatting/Clippy/full tests were not reached. This is prior-pipeline evidence, not verification of expanded transcript logging. No expanded tests/checks/builds/app launch, paid prompt, live session loading/deletion or settings/log mutation was performed for this task. Mandatory post-merge cargo compilation is tracked separately. macOS/Linux native collection, overhead, large-history limits, disk failures and multi-process acceptance remain unverified; fixtures do not establish native/platform parity.
