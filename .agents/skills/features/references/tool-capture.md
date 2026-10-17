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
- Writes dispatch after approximately 100 ms, serialized per sink. Pending data is bounded to 8 Mi UTF-16 code units, with 2 Mi per record. Synchronous history bursts may exceed 512 queued records without failing: each dispatch removes at most 512 for the native batch. Pending bytes remain bounded; no silent sampling/truncation.
- Native validation retains 512 records/32 MiB per batch and 8 MiB per line. Oversized individual history snapshots can therefore fail visibly; capture does not silently split/rewrite native event payloads.
- Serialization, overflow or storage failure stops that window's logger and reports one shared application notice. Toggle off/on for a new segment; never retry ambiguous writes. Late failures from a retired segment cannot stop a new one. Logging failure cannot change session semantics.
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
  copilot-sdk/copilot/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Former `tool-captures/` files are left untouched—no migration, truncation, pruning or expansion. Settings shows the new exact root even while disabled. Existing doc/module/IPC/preference names containing tool-capture are compatibility names; the current feature is transcript debug logging.

Backend/agent segments are derived natively, never frontend-supplied paths. Ordinary alphanumeric/hyphen/underscore names remain readable; unsafe/long names use hash-derived segments and retain original identity in records. Files partition by receipt timestamp normalized to UTC, not modification time. Interleaved sessions/windows remain distinguishable through envelope IDs.

Files are created 0600 and directories 0700 on Unix. The writer rejects symlink/nonregular destinations and nonprivate/hard-linked Unix files; Unix opens use no-follow/nonblocking flags and advisory exclusive locks. Workers serialize app-wide and validate closed envelope fields while accepting arbitrary native JSON payloads. Opt-in is rechecked natively at command acceptance. Existing incomplete final lines fail visibly without modifying/truncating files; preserve/move them aside explicitly before retry. Windows lacks Unix permission/locking/no-follow guarantees and is not a current parity commitment.

Full prompts, answers, reasoning, attachments in native payloads, source, commands, paths, outputs and secrets can be recorded. No silent redaction/upload/automatic sharing/deletion or harness-session mutation. Timing-only performance reports keep their separate purpose/retention.

## Code map and verification

- `src/tool-capture.ts`: existing shared sink/envelope/buffering/generation/failure/disposal; native-batch chunking for synchronous replay bursts.
- `src/pi/{tool-capture,transport,session}.ts`: all native Pi event capture, RPC trace hook, controller actions/configuration progress and session identity.
- `src/copilot/session.ts`: native/history/duplicate events, bridge requests/results/decisions, early identity/version and UI markers.
- `src/acp/session.ts`: native updates, replay tags, JSON-RPC exchanges, UI markers and disconnect.
- `src/settings-surface.ts`, `index.html`, `src/preferences.ts`, `src/main.ts`: renamed single setting, compatibility key, shared sink injection and notice routing.
- `src-tauri/src/tool_capture.rs`: unchanged writer guarantees/command names; new transcript-logs root and diagnostic wording.

Expanded fixtures are authored **but unrun**: `test/tool-capture.test.ts` covers full native Pi text/reasoning, correlated generation, history RPC/extension replies/disconnect and >512-record replay batching; `test/copilot-tool-capture.test.ts` covers exact tool/native events, duplicate delivery, empty tool-only assistant history, prose/reasoning/input decisions, disabled collection, mutation snapshots and early identity; `test/copilot-bridge.test.ts`, `test/copilot-sdk.test.ts`, `test/acp-session.test.ts`, `test/shell.test.ts` and browser fixture paths are updated for expanded capture. Existing sink failure/overflow/nonretry/retired-generation fixtures remain relevant. The native fixture now asserts the new resolved directory suffix; existing permission/append/partition/lock/tail/symlink guarantees remain unchanged.

Earlier **tool-only** capture evidence: 13 focused controller/production-bridge/sink Node tests and six native storage fixtures passed. Its full `mise run test` passed TypeScript/docs then stopped on four unrelated stale migration assertions (918/922 Node tests); later Rust formatting/Clippy/full tests were not reached. This is prior-pipeline evidence, not verification of expanded transcript logging. No expanded tests/checks/builds/app launch, paid prompt, live session loading/deletion or settings/log mutation was performed for this task. Mandatory post-merge cargo compilation is tracked separately. macOS/Linux native collection, overhead, large-history limits, disk failures and multi-process acceptance remain unverified; fixtures do not establish native/platform parity.
