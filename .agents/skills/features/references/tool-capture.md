# Tool activity capture

**Status: implemented; fixtures authored but not run. No native/platform acceptance.** User guide: [Tool activity logs](../../../../docs/tool-capture.md). Related: [preferences](preferences.md), [consumer interfaces](consumer-interfaces.md), [performance diagnostics](performance-diagnostics.md), [card plugins](card-plugins.md).

## Consumer and minimum contract

The consumer is a local card-design/debugging workflow: inspect observed tool names, native payload shapes and lifecycle changes, then derive bespoke card plugins and offline fixtures. This is not a universal harness protocol, conversation recorder or execution API.

`src/tool-capture.ts` owns `ToolCaptureSink`: a read-only `enabled` flag and synchronous, nonthrowing `append(ToolCaptureRecord): void`. A record supplies `source` (backend, agent, optional reported version), session ID, optional stable connection ID/tool-call ID, native event name and selected native JSON payload. Integrations decide what tool activity means; the sink never interprets tool names, schemas, capabilities or permissions. Adding an integration requires supplying source identity and forwarding its native tool events to this port, not adding a storage backend or normalizing its events into Pi/ACP.

The implementation adds `schemaVersion: 1`, receipt-time UTC RFC3339 `timestamp`, window-capture UUID `captureId`, and increasing `sequence`. Ordering is within that capture segment, not a global order across windows. Time is wall-clock receipt time, not tool execution time; clocks can move backwards. Stable per-connection UUIDs preserve correlation through Pi's early native-session discovery; temporary/unidentified Pi sessions use a runtime session ID until the native ID is known. Pi partial input records include a connection-local assistant `messageSequence` and native content index when no tool-call ID is supplied. Capture beginning mid-call may lack preceding identity/input events.

## Setting and lifecycle

- Global Settings → Diagnostics → **Capture tool activity**, persisted as validated boolean `diagnostics.toolCapture`, defaults **false**. Global-only, like existing Diagnostics preferences; project files cannot override it. Changes synchronize through existing preference subscriptions without starting/restarting agents or recreating views.
- Project/welcome windows own one sink in `installSettingsSurface`; Global Settings edits the preference but does not collect events. Only connected integrations with supplied sinks produce records. Hidden sessions are included independently of deferred transcript painting.
- Enabling starts a new segment UUID/sequence and captures subsequent events only. No snapshot walk, historical Pi message fetch, prompt, restart, or live provider request. ACP saved-history replay is excluded.
- Disabled append does not inspect/serialize payloads or schedule work. Enabled append serializes a snapshot immediately, before reducers/permission-state merging can mutate retained data. This incurs payload-size-proportional work; capture is diagnostics, not a performance optimization.
- Buffered writes dispatch after approximately 100 ms and are serialized per sink; native workers serialize app-wide and Unix advisory locks prevent cooperating processes from interleaving file appends. Ordered harness processing never waits for disk. No renderer, draft, focus, scroll or transcript state is modified.
- Disabling discards undispatched buffered events; accepted native writes may finish. Disposal dispatches an available tail best-effort, but pending events behind an in-flight write and process/crash tails may be lost. This is not a durable audit journal or per-event fsync contract.
- Pending memory is bounded to 512 records/8 Mi UTF-16 code units; individual records to 2 Mi code units. Native validation permits at most 512 records, 32 MiB per batch, 8 MiB per line. No payload is silently truncated. Serialization/overflow/write failures stop that window's sink and report one shared application notice; toggle off/on to start another segment. Already accepted records may have been written. Never automatically retry ambiguous appends. Late failures from retired segments cannot stop a newly enabled segment.

## Concrete integration mapping

### Pi

`src/pi/tool-capture.ts` selects all `tool_execution_*` events, independent of tool name (including extension tools), model `toolcall_*` generation events, final assistant tool-call blocks and final tool-result messages. Native execution result objects retain structured/custom metadata rather than card-flattened text.

Generation captures retain the native `assistantMessageEvent` tool fields but **omit `partial`**, which embeds the entire assistant message including unrelated text/reasoning. They also omit the enclosing full-message snapshot. Final assistant capture selects tool-call blocks only. User prompts, assistant prose, thinking and history responses are not collected. Source is `pi`/`pi`; no Pi version is invented.

### ACP

`src/acp/session.ts` captures received `tool_call`/`tool_call_update` patches before merging and live `session/request_permission` tool details/options before retained-state enrichment. Source is `acp` plus negotiated agent name (or `unknown`) and version when reported. Arbitrary `rawInput`, `rawOutput`, structured content, locations and extension metadata remain intact. Loading/replaying saved history is excluded; permission requests canceled by ACP's existing state rules do not acquire a new capture/approval path. Other session updates, conversation text, reasoning and discovery processes are not captured.

Permission decisions/execution remain integration-owned; logging supplies no permission, prompt, tool, file-opening or transport control capability.

## Native storage

Resolved native state directory, honoring absolute `XDG_STATE_HOME` and existing portable fallback:

```text
~/.local/state/nimrod/tool-captures/
  pi/YYYY-MM-DD.jsonl
  acp/copilot/YYYY-MM-DD.jsonl
  acp/<agent>/YYYY-MM-DD.jsonl
```

Settings shows the exact resolved root, including while disabled. Backend/agent segments are derived natively from metadata, never accepted as paths. Ordinary alphanumeric/hyphen/underscore names remain readable; unsafe/long names become SHA-256-derived segments, with original names retained inside records. Future backends use the same partition rule; Pi alone omits a redundant agent directory.

Day selection comes from each record's receipt timestamp normalized to UTC, not write time or file modification time. Each record is one compact JSON object plus newline. Existing files are opened append-only; no automatic deletion, pruning, truncation, rewriting or migration. Interleaved sessions remain identifiable through envelope fields. Search by timestamp across relevant daily files; do not assume globally monotonic timestamps or line ordering across files/windows.

Files are created 0600 and directories 0700 on Unix. Writer rejects symlink/nonregular destinations and Unix nonprivate/hard-linked files; unsafe capture-directory entries are rejected. Unix opens use no-follow/nonblocking flags and advisory exclusive locking. A preexisting incomplete final line causes a visible failure rather than appending behind it or discarding data; preserve/move that file aside explicitly to recover. Native error messages identify affected paths. Writes run on a blocking worker, validate closed envelope fields while accepting arbitrary JSON payloads, and recheck global opt-in at command acceptance. The existing resolved state parent remains authoritative. Windows lacks Unix permission/advisory-lock/no-follow guarantees and is not a current parity commitment.

Logs can contain source code, commands, outputs, credentials and tool-embedded prompts/reasoning. No silent redaction, upload, automatic sharing or harness-session mutation. Performance reports remain timing-only and separate; their retention rules do not apply here.

## Code map and evidence

- `src/tool-capture.ts`: shared port, snapshot/envelope, buffer, generation/failure/disposal lifetime.
- `src/pi/tool-capture.ts`, `src/pi/session.ts`: Pi-native selection/identity; `src/acp/session.ts`: ACP-native selection.
- `src/settings-surface.ts`, `src/main.ts`, `index.html`, `src/preferences.ts`: window-owned sink, global control/path/status, integration injection and synchronization.
- `src-tauri/src/tool_capture.rs`, `preferences.rs`, `main.rs`: typed envelope validation, source/day partitioning, private append-only native writes and IPC.
- `test/tool-capture.test.ts`, `test/acp-session.test.ts`, `test/preferences.test.ts`, `test/shell.test.ts` and Rust module fixtures: snapshot/disabled behavior, native tool selection/privacy, replay exclusion, partial patch/permission preservation, failure/no-retry, settings and source/file separation. Browser demo mocks remain offline and never write capture files.

Tests/checks/builds have **not been run** for this feature. No app launch, personal settings/log mutation, live tool/provider request or native acceptance was performed. Actual macOS collection, disk-failure behavior, multi-process advisory locking and Linux behavior remain unverified; fixture source is not platform acceptance.
