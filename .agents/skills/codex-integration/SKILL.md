---
name: codex-integration
description: Implement, debug or review Nimrod's bespoke Codex app-server integration. Owns staged implementation, protocol evidence, anomalies, design decisions, limitations and the remaining native/session/UI work.
---

# Codex integration

**Status: protocol/client foundation only. Codex is not yet selectable or usable in Nimrod.**
Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md), [consumer interfaces](../features/references/consumer-interfaces.md) and this skill before continuing. For UI changes also load the [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md). Follow repository `AGENTS.md`: task worktrees, local-only work, no automatic tests/builds/app launches or real model/session operations, and the required post-merge compile check. [Verification](../features/references/verification.md#codex-foundation) owns executed evidence and acceptance gaps.

## Decision

Use the installed **`codex app-server` over local stdio**, not ACP and not the TypeScript automation SDK. OpenAI recommends app-server for custom rich clients with history, authentication, approvals and streamed events; the SDK is primarily an automation surface. Native stdio also avoids adding a Node SDK bridge just for Codex. This is a design choice, not an implemented launcher.

Sources: [SDK](https://developers.openai.com/codex/sdk/), [app-server](https://developers.openai.com/codex/app-server/), [upstream implementation](https://github.com/openai/codex/tree/main/codex-rs/app-server). Use installed/released protocol evidence before coding; live documentation may describe a newer release. The inspected local CLI is **`codex-cli 0.162.0`**. See [protocol evidence](references/protocol-evidence.md) for reproduction and differences from earlier assumptions. This is the reviewed baseline, not a runtime compatibility check or a promise of arbitrary-version compatibility.

## Current code map

| Code | Responsibility |
| --- | --- |
| `src/json-rpc-connection.ts` | Shared ordered JSON-RPC request correlation, synchronous result application, bidirectional callbacks, cancellation and fail-closed disconnect. No harness/session semantics. |
| `src/acp/connection.ts` | Thin existing-API compatibility wrapper enforcing ACP's mandatory `jsonrpc: '2.0'`; error exports remain constructor aliases. ACP remains separate. |
| `src/codex/protocol.ts` | Hand-maintained, runtime-validated consumer subset of the inspected schema. Unknown item variants retain native payloads, not invented Pi/ACP equivalents. |
| `src/codex/client.ts` | Concrete single-connection/single-thread owner: handshake, identity, turn start/steer/interrupt, explicit paginated discovery/history and basic approval callbacks. |
| `test/json-rpc-connection.test.ts` | Authored shared-mechanics/dialect/cancellation fixtures; existing ACP connection/client fixtures remain regression coverage. |
| `test/codex-client.test.ts` | Authored offline handshake, identity/order, limits, lifecycle/races, history, delivery failure and approval retirement fixtures. |

There is **no native Codex host, `CodexSession`, presentation projection, `SessionBackend` alternative, saved sidebar encoding, draft scope, settings control or creation action yet**. Do not expose an action that cannot provide correct ownership, approval presentation and delivery reconciliation. No new dependency is required by this slice. No user-facing changelog entry is warranted for a dormant foundation and an intended behavior-preserving RPC extraction; add one with the usable integration.

## Interface boundaries

Extract from real consumers; do not build a universal `Harness` controller:

- ACP and Codex now share **only JSON-RPC mechanics**. Their version-member dialects remain explicit. Pi framing/correlation is untouched. Never send Codex events through ACP/Pi reducers.
- `CodexWriter.write` is the client consumer's narrow ordered-record writer. It may finish at transport-write completion, **not** server acceptance or turn completion. The eventual native host must supply framing limits, ownership and process supervision separately.
- `CodexClientHooks` binds concrete Codex effects. `identified` executes synchronously before event replay and must validate shell ownership and bind identity/drafts. `event` is synchronous native semantic ingestion; only waiting for an approval answer is asynchronous. Hooks must not navigate or replay work.
- Existing `SessionMessageInput`, `SessionPersistence`, `SessionConnectivity`, `ConversationViewHost`, `SessionConfiguration`, Status-area and history consumer interfaces are the next integration targets, not replaced by this client. Reuse their documented lifecycle/optimistic guarantees. Add smaller ports only where a real consumer needs them.
- Concrete launch responsibility is still partly in `main.ts`. Prefer a separate Codex connection owner with minimal shell effects instead of another large shell launch function or a catch-all host callback interface. Do not imply that the transport extraction has completed shell extraction.

## Client guarantees and non-guarantees

### Connection and identity

- Instances are single-use. Initialize exactly once, acknowledge with `initialized`, then create/resume explicitly. No fallback create after a failed resume, retry loop, reset, prompt replay or session-file editing.
- The response callback applies authoritative state synchronously before later records. Early notifications during opening are bounded to **128 records / 1 MiB UTF-8 serialized params**, then released only after exact identity/project validation and shell binding. Over-limit input disconnects rather than silently dropping events. Native framing/record limits remain future work.
- New threads request `ephemeral: false`. Both returned thread cwd and response cwd must equal the native-canonical project supplied by the caller; resumed IDs must match exactly. The TypeScript client does not canonicalize filesystem paths or prove native ownership.
- `threadId` survives disconnect for reconciliation; it does not prove a durable Nimrod draft/sidebar record exists. Persistent namespaces must be added deliberately in the next slice, not inferred from the protocol client's field.
- Child/foreign-thread notifications do not enter the bound conversation. Approval requests for another thread/turn receive a request-local error, never a grant. Bound-thread unknown notifications remain native events for future adapters.

### Turns and delivery

- `startTurn` is idle-only; steer explicitly uses `expectedTurnId`; interrupt explicitly uses the observed active ID. There is no fabricated queue or automatic steer fallback.
- Prompt/steer text carries a caller-provided `clientUserMessageId`; use the native user item's `clientId` to reconcile the future optimistic preview. The current client does not render or clear drafts.
- A start response acknowledges the request; it is not completion. The client does not project its older item snapshot over subsequent stream events. A completion before the response cannot resurrect a working turn. An interrupt acknowledgement leaves the turn working until its terminal event.
- RPC rejections use `RpcResponseError`; malformed input, transport loss and acknowledgement timeout use `RpcConnectionError` (delivery may be unknown). No retry is safe merely because a method timed out. Default acknowledgement deadline is 20 seconds, not a turn-duration limit or an approval-answer deadline.
- A live paginated resume can report active status without an active turn payload. It remains working but cannot steer/interrupt until a concrete turn event supplies identity. **Remaining limitation:** recover active-turn identity from the supported runtime/history surface in the session owner; do not pretend Stop works while the ID is unknown.

### History

- Unbound initialized clients can discover exact-project, non-archived, non-ephemeral top-level threads. `modelProviders: []` includes all providers; omitted `sourceKinds` retains Codex's default interactive sources. Decide broader source visibility before promising all CLI/exec history.
- Discovery rechecks each result's cwd and excludes subagents. It preserves cursors even when all rows on a page are filtered; the caller must continue pagination, not mistake an empty filtered page for end-of-history.
- Resume requests `excludeTurns: true`. Explicit ascending turn pages request `itemsView: 'full'`; separate per-turn item pages remain necessary when the server reports incomplete items. No full-history hydration/orchestration, cancellation coordinator, cursor-cycle protection or live/history merge has been implemented yet. Consumers must inspect `itemsView` rather than treat `items` as complete.
- Discovery/open/history calls never send prompts. No direct history-file parsing, destructive method, archive/delete shortcut or migration is implemented.

### Decisions

- Only command-execution and file-change approvals are currently dispatched. Preserve native fields including `kind`, `approvalId`, reason, proposed policies and command cwd; the command cwd is not necessarily the project root. The RPC request ID, not the tool/item ID, owns a callback.
- Supported explicit responses: `accept`, `acceptForSession`, `decline`, `cancel`. Keep their Codex meanings; they are not universal permission modes. Policy-amendment objects, additional-permission requests, MCP elicitation, dynamic tools, legacy approval methods and external-token refresh are not implemented; unknown requests return method-not-supported errors, never fabricated success.
- Approval promises may remain pending independently of modal visibility. Server resolution, terminal turn or disconnect aborts pending callback scopes; late answers do not write stale replies. The **UI is not implemented**. Add the shared [dismiss-and-resume](../features/references/dismiss-and-resume.md) flow before exposing sessions; no auto-grant, no cancellation just because Escape closed a picker.
- Agent questions are described as experimental in the inspected schema. This slice opts out of experimental APIs and does not claim question/Plan support. Revisit deliberately with evidence; don't enable every experimental feature to obtain one request type.

## Next implementation slices

1. **Native host and runtime selection.** Resolve an installed Codex executable and reviewed version; use fixed app-server stdio arguments. Add narrow native request validation, exact-project checks, one ordered bounded channel, window/token/reload-generation ownership and process-tree teardown with observed exit. Failed stop must retain reservations. Reuse aligned native mechanics only after reviewing their actual guarantees; ACP's current host is not automatically sufficient. macOS first, Linux portable next; Windows remains unavailable until ownership is implemented.
2. **Session projection and delivery.** Implement a concrete `CodexSession` against shared message-input/view/configuration ports. Preserve native IDs, unknown-item Raw details and reasoning/tool lifecycle. Reconcile live events and paginated history without overwriting newer output or duplicating user previews. Extend dirty-row and hidden-session fixtures; don't copy another transcript/composer engine.
3. **Decisions and shell lifecycle.** Add retained approval UI/pending-action banners, notices and owner retirement, then saved identity/drafts, explicit create/Resume, history and bindable actions. Background results never select/navigate. Runtime Stop must never be confused with cancel-turn.
4. **Capabilities.** Use supported advertised models/effort and real usage/configuration data; hide unsupported controls. Evaluate images, questions, compaction, slash commands and deletion separately. Do not submit slash text as plain prompts to emulate CLI commands.
5. **Acceptance.** On explicit validation authorization run `mise run test`; add requested offline browser coverage for rendering/scroll changes. Live prompts, real saved-session operations and native app interaction need separate authorization. Building/packaging also requires an explicit request.

Update this skill's decisions/anomalies/limitations with implementation changes. Keep executed results in [verification](../features/references/verification.md#codex-foundation), shared contracts in their canonical feature references, and user guidance separate once there is a user-visible feature.
