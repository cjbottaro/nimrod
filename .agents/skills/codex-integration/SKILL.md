---
name: codex-integration
description: Implement, debug or review Nimrod's bespoke Codex app-server integration. Owns interface mappings, protocol evidence, anomalies, design decisions, limitations, policy questions and remaining acceptance work.
---

# Codex integration

**Status: core desktop integration source-implemented; offline fixtures authored but unrun. Not verified native or full harness parity.** Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md) and [consumer interfaces](../features/references/consumer-interfaces.md). For UI also load [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md). Repository `AGENTS.md` owns local-only work, task worktrees, validation/build authorization and mandatory post-merge checks. [Verification](../features/references/verification.md#codex-integration) owns executed evidence; [user guide](../../../docs/codex.md) owns visible behavior.

## Decision and evidence

Use the installed **`codex app-server --listen stdio://`**, not ACP or the TypeScript automation SDK. OpenAI recommends app-server for rich custom clients. Nimrod adds no Node bridge or Codex runtime dependency, never attaches to an existing user's server, and inherits Codex's authentication/configuration/policies. There is no in-app login/logout, token import or configuration-file rewriting.

The reviewed local protocol is **Codex CLI 0.162.0**. [Protocol evidence](references/protocol-evidence.md) records generator inputs, inspected shapes and limitations. This is a reviewed baseline, **not a runtime semver gate or arbitrary-version compatibility promise**. The official [app-server reference](https://developers.openai.com/codex/app-server/) establishes that deletion is recursive and resume overrides exist; it does not establish acceptance of overrides on an already-loaded idle thread. Keep that distinction explicit.

## Capability map

| Workflow | Current implementation / boundary |
| --- | --- |
| Create, explicit Resume, multiple live sessions | Native app-server process per conversation; exact project/thread identity. Pi remains default New session. |
| Saved sidebar, pinning, recency, drafts | Tagged `codex` identity and `codex:<JSON-encoded thread ID>` scope; independent from Pi/Copilot even when IDs match. Restored rows await explicit selection. |
| Discovery/history | Separate discovery process; project-scoped, non-archived, non-ephemeral top-level CLI/VS Code/app-server threads. Turn/item/model pagination with cursor-cycle protection and cancellation of consumer waits. |
| Streaming and history reconciliation | Native IDs, optimistic `clientUserMessageId` → `userMessage.clientId` adoption, dirty rows, stable controls and live-over-history precedence. No duplicated transcript/composer engine. |
| Native items/cards | Assistant/reasoning, command console output, file diffs, generic tools/MCP/unknown items with raw recovery. Native turn failures render as error records. |
| Send, steer, Stop | Idle start; active-ID text steering; actual turn interrupt. No follow-up queue, retry or replay. |
| Images | Inline data URLs, shared byte/draft limits and model-advertised modality. Image-only idle input supported; no image steering or arbitrary history-path reads. |
| Approvals | Command/file decisions, native request detail, retained FIFO picker, session-local banner, dismissal independent from settlement; terminal/server-resolved/disconnected callbacks abort. |
| Model/effort | Advertised catalog, shared deferred configuration operations and exact result confirmation. Idle `thread/resume` overrides; installed-runtime application remains an acceptance gap. |
| Status, alerts, diagnostics | Shared All/Unread/Working/input state, notices, notifications, pop-outs and native transcript logs. Token totals/last-turn window data only; no fabricated dollars/credits/current-context percent. |
| Restart | Unavailable, like existing Copilot; Close then explicit Resume. |
| Delete | Shared reviewed spawned-thread tree deletion through a guarded catalog; see [Codex deletion](references/deletion.md). Cross-project, incomplete-lineage and ambiguous-fork trees fail explicitly. |
| CLI slash commands | No advertised app-server catalog. Slash input rejects before draft clearing; never prompt-fallback or impersonate native CLI commands. |
| Structured questions / protocol opt-in | `experimentalApi: true` permits experimental protocol fields without enabling runtime feature flags. Reviewed non-secret question batches use the shared retained UI and exact keyed replies; unsupported interactions are visible and logged. [Contract/capture guide](references/questions.md). |
| Plan/Autopilot controls, MCP elicitation, permission amendments | Not implemented. Protocol opt-in does not select a mode or supply invented runtime semantics; unsupported requests return explicit errors, never grants. |
| Manual compaction, context-tier changes, live permission policy, MCP inspector | Not exposed. No guessed parity or extra provider work. |

This is **nearer to shared core-workflow parity**, not a claim of native acceptance, complete protocol coverage, Pi extension parity or Copilot mode parity. Adding a control/interface alone does not prove substitutability.

## Interface and code map

| Code | Owner / boundary |
| --- | --- |
| `src/json-rpc-connection.ts`, `src/acp/connection.ts` | Aligned ordered RPC mechanics only. ACP requires a version member; Codex omits it. Pi stays independent. Single-use connections and synchronous response application precede later events. |
| `src/codex/protocol.ts`, `client.ts` | Concrete schema subset/validation, one connection/thread, early-event limits, exact IDs/cwd, turn semantics, paginated APIs and basic approvals. Not a universal harness controller. |
| `src/codex/native.ts::CodexTransport` | Narrow project-bound process port used by conversation and discovery consumers: start, ordered write, observed stop. Tauri wiring is separate from session projection. |
| `src-tauri/src/codex.rs` | Dedicated window/token/generation ownership, fixed stdio launch, validated executable/cwd/operation allowlist, bounded records and retained failed-stop reservations. |
| `src-tauri/src/owned_process.rs` | Shared Unix group termination/exit observation, extracted from Copilot. SDK graceful `stopped` acknowledgement remains Copilot-owned; Codex does not fabricate that acknowledgement. |
| `src/codex/session.ts` | `SessionMessageInput`, `SessionConfigurationController`, shared view/status records, native-item projection, identity-based reconciliation and best-effort native logging. |
| `src/codex/connection.ts` | Concrete connection owner implementing the lifecycle port: attempt guards, ordered startup, synchronous identity/draft binding, primary/cleanup failure correlation and captured-token teardown. Shell host supplies gates and explicit Nimrod effects, not launch callbacks. |
| `src/codex/session-lifecycle.ts` | Existing `SessionPersistence`/`SessionConnectivity` consumer ports; stop is process teardown, not cancel-turn. |
| `src/codex/session-history.ts` | Existing `SessionHistory` port, separate catalog lifetime, no conversation creation/prompting. |
| `src/codex/session-deletion.ts`, `deletion-tree.ts`, `src-tauri/src/codex_deletion.rs` | Existing deletion ports/review, exhaustive spawned inventory, native affected-writer reservations, one recursive API call and confirmed-only reconciliation. [Contract and policies](references/deletion.md). |
| `src/codex/approval-interaction.ts`, `questions.ts`, `question-interaction.ts`, `src/question-interaction.ts` | Concrete Codex approvals/question schemas; shared retained palette and extracted Copilot/Codex question presentation own modality/FIFO/child input, not harness responses. [Question contract](references/questions.md). |
| `src/codex/view-policy.ts`, `card-plugins.ts` | Concrete keyboard/actions and public card presentation components. Card target is `codex`, not Pi/ACP. |
| `src/codex/integration.ts`, `integration-ui.ts` | Required registration/project/session ports, window-generation initialization, history association, lifecycle composition, activity/title/action projection and retained Codex approval/question UI. No shell Codex branches or launch callbacks. |
| `src/main.ts` | Shared registered-consumer composition, native window effects, navigation, attention and publication. Typed `SessionRequest` replaces concrete creation unions; all supported integrations use [registered consumer ports](../features/references/consumer-interfaces.md#implemented-extraction-and-registration-boundary). |
| `src/settings.ts` | Runtime form mechanics operate over a keyed field map; adding Codex does not add another parallel Save/reload implementation. |

Future extraction must remove actual consumer knowledge or move responsibility. Do not introduce a giant `Harness` interface or translate Codex events into Pi/ACP events just to reuse types. Native supervision registries remain concrete; only the proven process-group exit primitive is shared in this change.

## Startup binding anomaly

[Startup binding and cleanup diagnostics](references/startup.md) records the user's 0.164.0 successful native thread creation followed by a local draft-scope rejection, and a secondary cleanup error masking that cause. Codex scopes must be accepted by both the actual shared frontend draft store and native staging/deletion boundaries, not merely supplied by a lifecycle adapter. The fix preserves the first failure and adds scoped cleanup/phase diagnostics; the native EPERM mechanism and post-fix startup remain acceptance gaps. No history cleanup or sandbox-policy weakening is implied.

## Invariants and anomalies

### Ownership, persistence and startup

- One canonical directory per window. Both opened thread cwd and response cwd must match; resumed ID must match exactly. Native ownership is window/token scoped with reload generations and retired-token fencing. No OS-wide process scans or external-writer exclusion claims.
- Stop waits for group exit; failures retain the owned child/reservation for explicit retry. A reaped leader never authorizes re-signaling a potentially recycled group ID. macOS/Linux share Unix implementation; Windows launch is blocked until process-tree ownership exists. Actual platform behavior remains unverified.
- Native wire records cap at 16 MiB, stderr lines at 64 KiB, writer channel at 32 messages, writes at 5 seconds. Large single-item output can fail the record limit even with paginated history. Early events cap at 128 / 1 MiB serialized params and disconnect on overflow, never silently truncate semantic records.
- Resume is user-triggered for restored Codex rows. History may be discovered on explicit Resume after project association; it never binds a conversation or issues a prompt. Catalog errors remain source-local and must not block Pi history.
- Thread ID differs from Codex's tree-wide sessionId. Never key drafts by tree-wide sessionId. Saved identity persists through disconnect; no history migration or prompt replay occurs. Deletion is an explicit reviewed operation, never a connection side effect.

### Ordering, rendering and delivery

- Apply response identity/lifecycle synchronously before subsequent records. A start acknowledgement must not resurrect a turn that already completed or overwrite newer streamed content.
- History does not replace newer live rows **or their native delta bases**. Inspect `itemsView`; paginate items when not full. Retain cursors through empty filtered pages, reject repeated cursors. Unknown native items remain raw, not guessed equivalents.
- Live-resume active status may lack a turn ID. Hydrated in-progress turns or a valid thread-scoped server approval can establish it. Stop/steer reject until identified; no invented turn ID or new-prompt fallback.
- User previews reconcile only by native `clientId`, not content matching. Future image bytes/path recovery must not broaden file/network authority. Configuration/local previews never enter Codex history.
- Dirty updates publish only changed rows; insertion/history/terminal lifecycle uses full fallback. Preserve keyed rows, disclosures, focus, hidden-session catch-up and independent output/reader scroll. Tool arguments retain owned immutable identity across output-only deltas. Shell title/sidebar persistence runs only on changed shell signatures, not every token.
- RPC timeout/loss is uncertain delivery. A request-local rejection is distinct. Send never restores a newer draft, repeats recency/navigation or automatically retries. Interrupt acknowledgement is not completion. Interrupted tools/reasoning stop without claiming success.
- Configuration choices refresh catalog/readiness/dependencies before dispatch. Newer settings events outrank older override responses. Only exact returned model/effort is shown effective; mismatch/malformed reconciliation disconnects conservatively. No host-generated prompt, global config write or process restart is used to force configuration.

### Decisions and policy

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
4. **Model/effort fallback:** if loaded-thread resume overrides aren't honored by a particular CLI, should we offer explicit reconnect-and-resume configuration or next-turn-only intent? **Current policy: require returned effective confirmation, fail rather than speculate**. Do not silently reconnect or send a prompt. Pin/review a runtime version once installed-CLI acceptance is authorized.
5. **Approval ergonomics:** basic scopes are shown with complete native details, but proposed execution/network policy amendments are not actionable. **Current policy: no persistent-policy edits** until scope-labelled UX and exact request/response semantics are accepted.

## Fixtures and next acceptance work

Authored fixture locations: `test/codex-client.test.ts`, `test/json-rpc-connection.test.ts`, `test/codex-session.test.ts`, `test/codex-approval.test.ts`, `test/codex-questions.test.ts`, `test/codex-history.test.ts`, `test/codex-tree-deletion.test.ts`, `src-tauri/src/codex_tests.rs` and native deletion-gate tests; existing shell, history, runtime settings, draft, card and Copilot process fixtures remain regression targets. New native record tests are provider-free. These tests have **not been run**.

Next useful work: explicit offline `mise run test` plus browser fixtures for real shared-renderer/history/approval layout and scroll; then separately authorized installed-CLI no-provider handshakes/catalog probes and controlled real model/native acceptance. Need to verify exact model/effort overrides, image acceptance/history bytes, approval scopes/cancellation, history/live races, repeated Stop/Close/reload, child process cleanup and macOS/Linux native focus/notifications. Do not claim acceptance from TypeScript/Rust compilation or jsdom. Build/package only on explicit request; never launch/quit the user's app automatically.

[Codex deletion](references/deletion.md) owns the detailed tree policy, native reservation/known-not-written behavior, uncertainty and remaining fork/cross-project questions. Maintain design anomalies and policy questions here. Shared contract specifications remain in feature references; executed evidence remains in [verification](../features/references/verification.md#codex-integration).
