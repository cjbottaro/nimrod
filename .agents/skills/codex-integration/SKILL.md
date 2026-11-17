---
name: codex-integration
description: Implement, debug or review Nimrod's bespoke Codex app-server integration. Owns interface mappings, protocol evidence, anomalies, design decisions, limitations, policy questions and remaining acceptance work.
---

# Codex integration

**Status: core desktop integration source-implemented with offline fixture execution; whole-suite and native acceptance remain incomplete. Not full harness parity.** Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md) and [consumer interfaces](../features/references/consumer-interfaces.md). For UI also load [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md). Repository `AGENTS.md` owns local-only work, task worktrees, validation/build authorization and mandatory post-merge checks. [Verification](../features/references/verification.md#registered-harness-application-contract) owns current automated evidence and remaining gaps; [user guide](../../../docs/codex.md) owns visible behavior.

## Decision and evidence

Use the installed CLI's **managed local app-server daemon**, not ACP or the TypeScript automation SDK. Nimrod invokes supported `codex app-server daemon start`, connects to its returned control socket, and owns only client connections. It adds no Node bridge or Codex runtime dependency and inherits Codex's authentication/configuration/policies. There is no in-app login/logout, token import, configuration-file rewriting or daemon stop/restart. [Shared-daemon contract and 0.169.0 transport evidence](references/daemon.md) own setup, lifetime, multi-client replay and limitations.

The initial reviewed local protocol is **Codex CLI 0.162.0**, with the async-question path additionally reviewed against installed **0.164.0** and its matching native-client source. [Protocol evidence](references/protocol-evidence.md) records generator inputs, inspected shapes and limitations. This is a reviewed baseline, **not a runtime semver gate or arbitrary-version compatibility promise**. The official [app-server reference](https://developers.openai.com/codex/app-server/) establishes that deletion is recursive and resume overrides exist; it does not establish acceptance of overrides on an already-loaded idle thread. Keep that distinction explicit.

## Capability map

| Workflow | Current implementation / boundary |
| --- | --- |
| Create, explicit Resume, multiple live sessions | Independent client connection per conversation to the shared managed app-server; exact project/thread identity. Shared [creation actions](../features/references/session-creation.md) use the global/project default (initially Pi) or explicit harness selection. |
| Saved sidebar, pinning, recency, drafts | Tagged `codex` identity and `codex:<JSON-encoded thread ID>` scope; independent from Pi/Copilot even when IDs match. The visible restored selection reconnects at startup; background rows await selection, following the shared [navigation contract](../features/references/session-navigation.md#contracts). |
| Discovery/history | Separate discovery client; project-scoped, non-archived, non-ephemeral top-level CLI/VS Code/app-server threads. Turn/item/model pagination with cursor-cycle protection and cancellation of consumer waits. |
| Streaming and history reconciliation | Native IDs, optimistic `clientUserMessageId` → `userMessage.clientId` adoption, dirty rows, stable controls and live-over-history precedence. No duplicated transcript/composer engine. |
| Native items/cards | Assistant/reasoning, command console output, file diffs, generic tools/MCP/unknown items with raw recovery. Native turn failures render as error records. |
| Send, steer, Stop | Idle start; active-ID text steering; actual turn interrupt. No follow-up queue, retry or replay. |
| Images | Inline data URLs, shared byte/draft limits and model-advertised modality. Image-only idle input supported; no image steering or arbitrary history-path reads. |
| Approvals | Command/file decisions, native request detail, retained FIFO picker, session-local banner, dismissal independent from settlement; terminal/server-resolved/disconnected callbacks abort. |
| Model/effort | Advertised catalog, shared deferred configuration operations and exact result confirmation. Idle live `thread/settings/update`, confirmed by native settings notification and acknowledgement; no saved rollout required. Installed-runtime application remains an acceptance gap. |
| Status, alerts, diagnostics | Shared All/Unread/Working/input state, notices, notifications, pop-outs and native transcript logs. Token totals/last-turn window data only; no fabricated dollars/credits/current-context percent. |
| Rename session | Named creation supports one explicit create-then-native-rename attempt after readiness ([lifecycle](../features/references/session-naming.md#named-creation-via-native-rename)), never a reconnect/persistence workaround. Required [session naming port](../features/references/session-naming.md) through exact-bound-thread `thread/name/set`, ordered name events and native deletion guards. Runtime/native acceptance pending. |
| Reload session | Required `SessionReload` port; observed client detach followed by exact-thread Resume; shared daemon work may continue, preserving mounted identity/draft without replay. [Shared lifecycle](../features/references/projects-and-sessions.md#reload-session-lifecycle); new fixtures unrun, native acceptance pending. |
| Delete | Shared reviewed spawned-thread tree deletion through a guarded catalog; see [Codex deletion](references/deletion.md). Cross-project, incomplete-lineage and ambiguous-fork trees fail explicitly. |
| Slash commands | Required command port: `/model`, `/rename`, native `/compact`, thread-scoped `/mcp`, `/status`, `/pwd` (`/cwd`), `/ps`, plus read-only `/skills` and `/hooks` subsets. No generic app-server command catalog. [Compatibility matrix](../slash-commands/references/codex.md); [complete inventory and upgrade audit](../slash-commands/references/codex-audit.md) is mandatory on Codex upgrades/command anomalies. Native acceptance pending. |
| Structured questions / protocol opt-in | `experimentalApi: true` permits experimental protocol fields without enabling runtime feature flags. Reviewed non-secret RPC question batches use exact keyed replies. Async assistant questions use the same retained UI with optional Ignore and native-framed ordinary input; they survive completion until answered, ignored or superseded. Unsupported interactions are visible and logged. [Contract/capture guide](references/questions.md). |
| Plan/Autopilot controls, MCP elicitation, permission amendments | Not implemented. Protocol opt-in does not select a mode or supply invented runtime semantics; unsupported requests return explicit errors, never grants. |
| Context-tier changes, live permission policy, MCP inspector | Not exposed. MCP has a read-only slash report, not Pi's inspector. `/compact` uses the native compaction lifecycle only when explicitly invoked; no live compaction was run during source review. |

This is **nearer to shared core-workflow parity**, not a claim of native acceptance, complete protocol coverage, Pi extension parity or Copilot mode parity. Adding a control/interface alone does not prove substitutability.

## Interface and code map

| Code | Owner / boundary |
| --- | --- |
| `src/json-rpc-connection.ts`, `src/acp/connection.ts` | Aligned ordered RPC mechanics only. ACP requires a version member; Codex omits it. Pi stays independent. Single-use connections and synchronous response application precede later events. |
| `src/codex/protocol.ts`, `client.ts` | Concrete schema subset/validation, one connection/thread, early-event limits, exact IDs/cwd, turn semantics, paginated APIs and basic approvals. Not a universal harness controller. |
| `src/codex/native.ts::CodexTransport` | Narrow project-bound process port used by conversation and discovery consumers: connect, ordered write, observed client detach. Tauri wiring is separate from session projection. |
| `src-tauri/src/codex.rs` | Dedicated window/token/generation client ownership, validated executable/cwd/operation allowlist, bounded records and retained deletion reservations. `src-tauri/src/codex_daemon.rs` owns managed-daemon setup and Unix WebSocket transport; `codex_output.rs` keeps verified runtime-cwd evidence in a Codex-only IPC envelope. |
| `src-tauri/src/owned_process.rs` | Shared Unix group termination/exit observation for process-backed integrations. Codex daemon clients do not use it or fabricate SDK graceful `stopped` acknowledgements. |
| `src/codex/session.ts` | `SessionMessageInput`, `SessionConfigurationController`, shared view/status records, native-item projection, identity-based reconciliation and best-effort native logging. |
| `src/codex/connection.ts` | Concrete connection owner implementing the lifecycle port: attempt guards, ordered startup, synchronous identity/draft binding, primary/cleanup failure correlation and captured-token teardown. Shell host supplies gates and explicit Nimrod effects, not launch callbacks. |
| `src/codex/session-lifecycle.ts` | Existing `SessionPersistence`/`SessionConnectivity` consumer ports; stop is client detach, not cancel-turn. |
| `src/codex/session-history.ts` | Existing `SessionHistory` port, separate catalog lifetime, no conversation creation/prompting. |
| `src/codex/session-deletion.ts`, `deletion-tree.ts`, `src-tauri/src/codex_deletion.rs` | Existing deletion ports/review, exhaustive spawned inventory, native affected-writer reservations, one recursive API call and confirmed-only reconciliation. [Contract and policies](references/deletion.md). |
| `src/codex/approval-interaction.ts`, `questions.ts`, `async-questions.ts`, `question-interaction.ts`, `src/question-interaction.ts` | Concrete Codex approvals/question schemas; shared retained palette and extracted Copilot/Codex question presentation own modality/FIFO/child input, not harness responses. [Question contract](references/questions.md). |
| `src/codex/view-policy.ts`, `card-plugins.ts` | Concrete keyboard/actions and public card presentation components. Card target is `codex`, not Pi/ACP. |
| `src/codex/integration.ts`, `integration-ui.ts` | Required registration/project/session ports, window-generation initialization, history association, lifecycle composition, activity/title/action projection and retained Codex approval/question UI. No shell Codex branches or launch callbacks. |
| `src/main.ts` | Shared registered-consumer composition, native window effects, navigation, attention and publication. Typed `SessionRequest` replaces concrete creation unions; all supported integrations use [registered consumer ports](../features/references/consumer-interfaces.md#implemented-extraction-and-registration-boundary). |
| `src/settings.ts` | Runtime form mechanics operate over a keyed field map; adding Codex does not add another parallel Save/reload implementation. |

Future extraction must remove actual consumer knowledge or move responsibility. Do not introduce a giant `Harness` interface or translate Codex events into Pi/ACP events just to reuse types. Native connection registries remain concrete; no shared wire protocol or daemon ownership interface is introduced.

## Untouched-session persistence anomaly

Native CLI interoperability is required, not continuity available only to
Nimrod-created sessions. The accepted [durability contract](../features/references/session-durability.md)
separates local layout/drafts, runtime identity and saved history. Codex 0.164.0
returns a non-ephemeral ID and prospective rollout path before saving a thread.
The [installed-runtime probe](references/protocol-evidence.md#untouched-native-session-interoperability-01640)
reproduced native/app-server Resume failure for untouched threads and the distinct
saved-but-undiscoverable named-empty case. [Existing upstream issues](references/protocol-evidence.md#existing-upstream-issues)
track both mechanisms; no new issue/comment was posted.

Current behavior in `src/codex/connection.ts`:
- `savedSessionId` is a compatibility name for the exact layout reconnect
  candidate, not saved-history evidence. Bind its draft scope synchronously, but
  do not infer durability from that ID or `ephemeral:false`.
- Every existing row resumes that exact ID. Never create a replacement thread,
  auto-rename, send a synthetic prompt, scan native
  history files or write private databases to force persistence.
- Old `codexContinuity` metadata is ignored by layout decoding. Keep the row,
  title, pin and original draft/attachment scope; even `untouched:true` is not
  replacement authority. The earlier private checkpoint and saved-scope
  replacement mechanisms are removed.
- Runtime-only `historyConfirmed` comes from successful exact Resume or a
  successful `thread/turns/list` response, including an empty page. The latter is
  read-only in the reviewed native contract and requires saved materialization;
  no `includeTurns:true` read or full-resume workaround is used to cause a save.
  Best-effort checks run after new-session readiness, explicit rename/name
  notification or a native terminal turn. They coalesce, do not poll, block
  Send, project history over live rows or turn missing history into an untouched
  classification. Failures remain unconfirmed; retired/disconnected results
  cannot promote another runtime.
- Reload waits for that evidence. Deletion does not: an open row supplies its
  exact target to the independent catalog/source even when disconnected and
  unconfirmed. The catalog validates native existence/project/lineage before
  review and removal. An absent list entry is not
  enough to discard local state. The same Delete action handles authoritatively
  absent native targets with reviewed local removal after fenced owned stop and
  a native absence recheck; if shutdown saves history, it upgrades to native
  deletion. Unknown lookups/native mutation failures never become local cleanup.
  [Codex deletion](references/deletion.md#native-absence-and-local-removal) owns the
  exact classification, native fence and confirmation contract. Close consumes the lifecycle stop port independently of
  connection/history confirmation. The Codex badge tooltip qualifies
  unconfirmed history rather than claiming that a runtime ID is saved.
- Missing-rollout errors retain complete diagnostics and any cleanup failure in
  Details, with a concise headline that does not falsely promise saved history.
  Explicit New session with harness… → Codex is separate user intent, never a recovery side effect.

The user's native-create → no-Send → quit → Nimrod requirement remains limited by
Codex persistence/Resume/discovery in the reviewed version. Do not present removal
of Nimrod's workaround as an upstream fix. [Verification](../features/references/verification.md#registered-harness-application-contract)
separates authored fixtures, executed isolated probes and remaining native
Nimrod acceptance.

## Startup binding anomaly

[Startup binding and cleanup diagnostics](references/startup.md) records the user's 0.164.0 successful native thread creation followed by a local draft-scope rejection, and a secondary cleanup error masking that cause. Codex scopes must be accepted by both the actual shared frontend draft store and native staging/deletion boundaries, not merely supplied by a lifecycle adapter. The fix preserves the first failure and adds scoped cleanup/phase diagnostics. The later [owned-group teardown follow-up](references/startup.md#owned-group-teardown-after-graceful-exit) handles Darwin zombie-only group EPERM through observed child reaping and observation-only group disappearance; genuine permission/live-group failures still retain ownership. Post-fix native startup/Close acceptance remains pending. No history cleanup or sandbox-policy weakening is implied.

## Invariants and anomalies

### Ownership, persistence and startup

- One canonical directory per window; different host/Distrobox spellings stay separate projects. Discovery partitions unfiltered saved cwd exactly; Resume requires an exact-ID/project metadata read before attachment. Only subsequent runtime cwd values may use native filesystem-verified equivalence, never saved-history membership or deletion scope. New thread identity remains literal. The [project/runtime cwd contract](references/daemon.md#saved-project-identity-versus-runtime-cwd) owns the boundary and IPC evidence. Native ownership is window/token scoped with reload generations and retired-token fencing. No OS-wide process scans or external-writer exclusion claims.
- Stop waits for token-bound client teardown without stopping the shared daemon or interrupting work. macOS/Linux share Unix socket transport; Nimrod's Windows transport remains unavailable. Actual platform behavior remains unverified. [Daemon ownership](references/daemon.md#ownership-and-lifecycle) owns bounds and cancellation.
- Native wire records/frames cap at 16 MiB, daemon setup stdout/stderr each at 64 KiB, writer channel at 32 messages, writes at 5 seconds. Large single-item output can fail the record limit even with paginated history. Early events cap at 128 / 1 MiB serialized params and disconnect on overflow, never silently truncate semantic records.
- The visible restored Codex selection requests exact-ID reconnect at startup through the shared connection coordinator, like Pi and Copilot. Background rows remain disconnected until selected. Failed connection attempts are not automatically retried. Explicit Resume/Delete pickers discover history regardless of prior Nimrod project association (see [shared history](../features/references/session-history.md)); it never binds a conversation or issues a prompt. Catalog errors remain source-local and must not block Pi history.
- Thread ID differs from Codex's tree-wide sessionId. Never key drafts by tree-wide sessionId. Saved identity persists through disconnect; no history migration or prompt replay occurs. Deletion is an explicit reviewed operation, never a connection side effect.

### Ordering, rendering and delivery

- Apply response identity/lifecycle synchronously before subsequent records. A start acknowledgement must not resurrect a turn that already completed or overwrite newer streamed content.
- History does not replace newer live rows **or their native delta bases**. Inspect `itemsView`; paginate items when not full. Retain cursors through empty filtered pages, reject repeated cursors. Unknown native items remain raw, not guessed equivalents.
- Live-resume active status may lack a turn ID. Hydrated in-progress turns or a valid thread-scoped server approval can establish it. Stop/steer reject until identified; no invented turn ID or new-prompt fallback.
- User previews reconcile only by native `clientId`, not content matching. Future image bytes/path recovery must not broaden file/network authority. Configuration/local previews never enter Codex history.
- Dirty updates publish only changed rows; insertion/history/terminal lifecycle uses full fallback. Preserve keyed rows, disclosures, focus, hidden-session catch-up and independent output/reader scroll. Tool arguments retain owned immutable identity across output-only deltas. Shell title/sidebar persistence runs only on changed shell signatures, not every token.
- RPC timeout/loss is uncertain delivery. A request-local rejection is distinct. Send never restores a newer draft, repeats recency/navigation or automatically retries. Interrupt acknowledgement is not completion. Interrupted tools/reasoning stop without claiming success.
- Configuration choices refresh catalog/readiness/dependencies before dispatch. Use `thread/settings/update {threadId, model}` or `{threadId, effort}` on the existing idle runtime, never Resume (which requires a saved rollout even for a loaded new thread). Require both its empty acknowledgement and exact-thread `thread/settings/updated` with matching cwd and requested value, in either wire order. Confirmation is timeout-bounded; mismatch/malformed reconciliation or loss disconnects conservatively. Later settings events remain authoritative. The native boundary allows only one model/effort field, not cwd/policy changes. No host-generated prompt, global config write or process restart is used to force configuration.

### Decisions and policy

- Optional async questions retain native item/index identity and submit native-framed ordinary input, never RPC replies. Ignore is local-only; completion does not expire them. See [async question contract](references/questions.md#async-follow-up-questions).
- Native question batches preserve IDs, offered labels/free-text rules and blocking metadata; responses are one keyed RPC result, not prompts. No timeout-generated answer, partial batch, secret plaintext collection or automatic mode/feature selection. Unsupported interactions have session-local diagnostics plus opt-in raw capture.
- Command/file callbacks preserve native kind, approvalId, cwd, reason and proposed policy data. RPC request ID owns a reply; one item may own several callbacks.
- Supported basic decisions are Codex `accept`, `acceptForSession`, `decline`, `cancel`. No policy-amendment objects are synthesized. Permissions additional to this subset, MCP elicitation, dynamic host tools, legacy approval methods and external-token refresh fail explicitly.
- Escape hides only presentation. Pending queues, per-session banners, navigation suspension and explicit reopening use [dismiss-and-resume](../features/references/dismiss-and-resume.md). No background modal/focus/selection. Server resolution/terminal/disconnect retires stale answers.
- Inherit configured Codex sandbox/approval policy; don't silently replace it with a Nimrod opinion or a permissive default. No new credential storage or auth ceremony is introduced.

## Policy questions for the user

Safe defaults below are implemented; these are **not blockers silently waiting for an answer**:

1. **Recursive deletion — resolved for same-project spawned trees:** the user approved reusing Pi's existing review/coordinator and cleaning up its shared model. The [implemented Codex adapter](references/deletion.md) inventories all reviewed sources/archive partitions, protects and stops affected owned writers, rescans for new descendants and submits one recursive delete. Cross-project trees, missing ancestry and ambiguous forks remain explicit refusals. Future broadening needs evidence, not a Copilot-style single-row shortcut. Ordinary history now explicitly includes app-server roots so Nimrod-created sessions remain discoverable after Close.
2. **Experimental protocol/questions — user-approved opt-in:** connect with `experimentalApi: true`, implement the reviewed non-secret structured-question flow, and use raw logs to guide further adapters/presentation. Runtime feature flags and mode defaults are unchanged; no Codex Autopilot equivalent is assumed. [Questions](references/questions.md) owns strict schema/answer validation, batching, visible unsupported-request diagnostics and capture instructions. Plan controls remain separate future work. Secret input, arbitrary forms and unknown schemas are explicitly unsupported rather than guessed.
3. **History scope:** should Resume include archived and headless/exec threads, with explicit filters, or retain Codex's default interactive scope? **Current policy: non-archived CLI/VS Code/app-server roots**, all providers, exact project. Deletion separately inventories every reviewed source/archive partition so hidden descendants cannot silently escape review. Closing all rows retains project association but does not promise every CLI source is visible.
4. **Model/effort fallback:** use native live-thread settings updates, not saved-thread resume overrides. **Current policy: require acknowledgement plus effective settings notification, fail rather than speculate**. Older CLIs rejecting this API get an explicit failure, never a Resume fallback, reconnect or synthetic prompt. The targeted 0.169.0 schema review is recorded in protocol evidence; installed-CLI acceptance remains pending.
5. **Approval ergonomics:** basic scopes are shown with complete native details, but proposed execution/network policy amendments are not actionable. **Current policy: no persistent-policy edits** until scope-labelled UX and exact request/response semantics are accepted.

## Fixtures and next acceptance work

Authored fixture locations: `test/codex-client.test.ts`, `test/json-rpc-connection.test.ts`, `test/codex-session.test.ts`, `test/codex-approval.test.ts`, `test/codex-questions.test.ts`, `test/codex-history.test.ts`, `test/codex-tree-deletion.test.ts`, `src-tauri/src/codex_tests.rs` and native deletion-gate tests; existing shell, history, runtime settings, draft, card and Copilot process fixtures remain regression targets. New native record tests are provider-free. Current execution results, baseline failures and ignored installed-runtime smokes are recorded in [verification](../features/references/verification.md#registered-harness-application-contract), not inferred from earlier compile-only evidence.

Next acceptance work: verify the [shared-daemon transport/lifecycle](references/daemon.md#fixtures-and-acceptance), and resolve the recorded baseline suite/formatting/Clippy failures and, when requested, run offline browser fixtures for shared-renderer/history/approval layout and scroll. Installed-CLI no-provider handshakes/catalog probes and controlled real model/native acceptance remain separately authorized work. Need to verify exact model/effort overrides, image acceptance/history bytes, approval scopes/cancellation, history/live races, repeated Stop/Close/reload, child process cleanup and macOS/Linux native focus/notifications. Do not claim acceptance from TypeScript/Rust compilation or jsdom. Build/package only on explicit request; never launch/quit the user's app automatically.

[Codex deletion](references/deletion.md) owns the detailed tree policy, native reservation/known-not-written behavior, uncertainty and remaining fork/cross-project questions. Maintain design anomalies and policy questions here. Shared contract specifications remain in feature references; executed evidence remains in [verification](../features/references/verification.md#codex-integration).
