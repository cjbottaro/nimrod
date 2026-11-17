# Diagnostic logs

This reference owns the metadata-only diagnostic stream. [Transcript logging](transcript-logs.md)
owns the shared bounded frontend transport/native writer implementation; [user guide](../../../../docs/diagnostic-logs.md)
owns capture instructions and visible limitations. [Verification](verification.md#diagnostic-logs)
owns executed evidence. These records are never read as harness/session state.

## Setting and ownership

`diagnostics.diagnosticLogs` is a global-only boolean, default false, independently
validated in `src/preferences.ts` and `src-tauri/src/preferences.rs`. No legacy
alias or migration. The global Diagnostics panel uses the existing checkbox and
application-notice surfaces; project settings do not expose this global-only
category. `installSettingsSurface` configures one sink per project/welcome window;
global Settings only edits the setting. Preferences synchronization applies it
without reconnects, reads, prompts or history replay.

`src/diagnostic-logs.ts` reuses `createTranscriptLog` with a diagnostic-specific
failure label. It shares the existing 4096-record/16 Mi-character pending bounds,
50 ms/512-record/1 Mi-character batches, one admission IPC in flight, no retry and
capture-generation fencing. Native `append_diagnostic_logs` rechecks its own
setting and routes to the same `TranscriptLogs` writer instance and global
32-job/64 MiB bound, but a separate `diagnostic-logs/` root and independent 25 MiB /
250 MiB / seven-day rotation/retention. Private files, path/symlink validation and
interprocess writer locking remain shared. Errors use `diagnostic-log-error` and
an independent capture ID; they never fail chat or retire transcript capture.
Rejected admission reports capture loss rather than backpressure. Normal requests,
streaming and native dispatch never await a log flush or disk receipt.

## Copilot boundary

The optional `HarnessSessionHost.diagnosticLog` port is passed only as a sink;
shared consumers do not inspect Copilot semantics. `copilot/diagnostics.mjs`
owns the explicit metadata allowlist and is staged/verified alongside the bridge.
Both bridge emission and `CopilotSession.diagnostic` project through it. Do not
log arbitrary objects and then redact secrets: select only primitive fields from
known diagnostic events. No tool IDs/content, prompts, history, attachments,
credential/provider configuration, error messages/stacks/causes or SDK wire dumps.
Model IDs, saved IDs, resolved CLI paths and numeric metadata are intentional.
Preserve omission versus explicit null/zero. Observer exceptions are ignored by
the configuration adapter so logging cannot fail configuration.

The frontend adds a boolean `diagnostics` field to normal bridge requests when
the sink is available. The native bridge validator accepts only a boolean; the
Node bridge applies it before processing the request. This is not a new harness
RPC, semantic protocol or UI acknowledgement gate. Disabled bridge capture returns
before projection/serialization. Toggle-on alone sends no request and takes effect
for bridge metadata at the next ordinary request; toggle-off stops frontend capture
immediately. A complete capture requires enabling before explicit Resume/Reload.
History-only discovery connections do not opt in or create diagnostics sessions.

Bridge records cover executable/Node startup, runtime status, create/Resume
requested/returned identity and flags, creation defaults, public model snapshot
before/after Nimrod's fallback, the selected catalog entry's numeric capacity
fields, and context numeric fields/null/absence. Connect
intent includes its bridge request ID. `operation.failed` is categorical and
limited to initialize/connect/context/configure; never pass errors through it.
It does not fabricate a raw private Resume RPC response. The public SDK return
identity, public model snapshot and context read are separate observations.

`CopilotSession` adds its existing per-connection UUID and current saved/connecting
identity. Its display decision record is deduplicated by relevant scalar state:
selected model/tier, measured/advertised window, usage, mutation state and source
(`reported`, `catalog-standard-preview`, `catalog-reported-tier`, `unknown`). No
per-token logging or extra metadata reads. Diagnostic packets are not conversation
records or transcript log records, and unknown diagnostic events are ignored
without disconnecting. Late diagnostic writer failures use capture-generation
fences, not session teardown. Normal transcript logging remains independent.

## Code and fixtures

- `src/{diagnostic-logs,transcript-logs,settings-surface,preferences,harness-host,main}.ts`:
  sink transport, setting/UI composition and session-host plumbing.
- `copilot/{diagnostics,configuration,bridge}.mjs`, `src/copilot/{session,integration}.ts`:
  allowlisted observations and controller display decisions.
- `src-tauri/src/{transcript_logs,preferences,copilot,main}.rs`: shared writer,
  native opt-in/path/error isolation, request validation and commands.
- `test/diagnostic-logs.test.ts`: independent opt-in/capture, loss/failure labels,
  null/omission/zero, privacy projection and nonthrowing configuration observer.
- `test/copilot-bridge.test.ts`: off-by-default and enabled Resume/context metadata,
  disabling, no conversation capture and end-to-end controller correlation.
- `test/preferences.test.ts`, `test/shell.test.ts`, native `transcript_logs` fixtures:
  boolean setting and independent storage/opt-in; shared transport tests own queue
  bounds, rotation, no retry and stale-error handling. Fixture locations do not
  establish execution or native acceptance.
