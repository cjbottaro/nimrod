# Reviewed Codex protocol evidence

## Local source, not a live integration test

The initial review used `/opt/homebrew/bin/codex` reporting `codex-cli 0.162.0`; the subsequent async-question review below used installed `0.164.0`.
The implementation reviewed local generated types produced by:

```sh
codex --version
codex app-server generate-ts --out <disposable-directory>
```

No `--experimental` flag was used. The generator's help itself calls generation experimental; generated presence is not proof that every described feature is enabled, production-stable or available on older CLIs. Only schema generation and help/version inspection were performed—no app-server connection, authentication change, thread open/list/load, prompt or user-data operation. Generated output was inspection material, not a new dependency or a vendored full protocol tree. `src/codex/protocol.ts` is explicitly a hand-maintained consumer subset, with runtime validation of identity/lifecycle/page shapes. Validate incoming item-specific fields in the future projector rather than trusting TypeScript casts.

## Shapes that informed implementation

| Generated file(s) | Observed shape / consequence |
| --- | --- |
| `InitializeParams.ts`, `InitializeCapabilities.ts`, `InitializeResponse.ts` | Client metadata plus explicit capabilities; response contains `userAgent` and platform/home metadata. Client now opts into experimental protocol fields with user approval, keeps attestation off and does not enable runtime feature flags; unrelated metadata is ignored. No semver negotiation or exact runtime version check is implemented here. |
| `v2/ThreadStartParams.ts`, `ThreadStartResponse.ts` | Optional cwd/ephemeral; response includes both thread and effective cwd/configuration. New threads explicitly request persistence and validate both cwd fields. Inherit Codex configuration rather than silently overriding approval/sandbox/model policy. |
| `v2/ThreadResumeParams.ts`, `ThreadResumeResponse.ts` | Resume by `threadId`; alternate history/path mechanisms exist, but can supersede identity and are not used. `excludeTurns` supports explicit paginated hydration. Response also includes backwards cursors; current explicit ascending pagination does not consume them. |
| `v2/Thread.ts`, `ThreadStatus.ts` | Thread ID is not the same as tree-wide `sessionId`. Fields include cwd, ephemeral, parentThreadId, status and turns. Never key drafts by tree-wide sessionId. Active status can exist without hydrated turn identity. |
| `v2/TurnStartParams.ts`, `UserInput.ts`, `ThreadItem.ts` | `clientUserMessageId` correlates to `userMessage.clientId`; text input uses snake-case `text_elements`. Prompt acknowledgement is a turn snapshot, while subsequent events carry native item updates. |
| `v2/TurnSteerParams.ts`, `TurnSteerResponse.ts` | `expectedTurnId` is required; response carries `turnId`. Do not treat steering as a queued follow-up or fall back to a new turn on precondition failure. |
| `v2/TurnInterruptParams.ts`, `TurnInterruptResponse.ts` | Interrupt takes `threadId` and `turnId`, returns an empty object. Terminal turn status is separately authoritative. |
| `v2/ThreadListParams.ts`, `ThreadListResponse.ts` | Exact cwd filter, provider/source filters, nullable next cursor. Default source scope is interactive. Empty modelProviders includes all providers. Result rows still require local project/subagent checks. |
| `v2/ThreadTurnsListParams.ts`, `ThreadTurnsListResponse.ts`, `TurnItemsView.ts` | Explicit sort direction and items-view contract (`notLoaded`, `summary`, `full`). Default is summary; requesting full still does not replace checking the returned view. |
| `v2/ThreadItemsListParams.ts`, `ThreadItemsListResponse.ts`, `ThreadItemEntry.ts` | Separate item pagination; entries include their owning `turnId`, native item and timing. Opaque cursors must be retained across filtered/empty pages. |
| `ServerRequest.ts`, `v2/CommandExecutionRequestApprovalParams.ts` | Modern command/file approval requests are bidirectional. A command's `approvalId` can distinguish multiple callbacks for one item; transport request ID remains the actual reply key. Command kind/cwd/network-policy details must remain available to approval presentation. |
| `v2/CommandExecutionApprovalDecision.ts`, `FileChangeApprovalDecision.ts` | Basic decisions are accept/session-accept/decline/cancel. Command decisions additionally permit structured policy amendments; these are deliberately unsupported in the first slice. |
| `v2/ServerRequestResolvedNotification.ts` | `{threadId, requestId}` retires pending callbacks without a response. Modal lifetime must not be tied only to turn completion or callback resolution. |
| `v2/ToolRequestUserInputParams.ts`, `ToolRequestUserInputResponse.ts` | Explicitly documented EXPERIMENTAL, with questions/answers and blocking semantics. The reviewed non-secret batch adapter is implemented; see [questions](questions.md) for exact schema mapping, supported subset, unresolved mode availability and capture instructions. |
| `ClientRequest.ts`, `v2/ThreadDeleteParams.ts` | This installed version has `thread/delete`, in addition to archive. Earlier advice to avoid assuming deletion remains sound, but deletion is not absent from the inspected schema. The guarded tree adapter is now implemented; real deletion probes remain unauthorized unless explicitly requested. See [tree deletion](deletion.md). |

App-server's JSON-RPC wire deliberately omits `jsonrpc: '2.0'`, unlike ACP. This dialect detail comes from the official [app-server documentation](https://developers.openai.com/codex/app-server/); generated request unions also omit the member. The shared connection is configured explicitly for each dialect and does not reinterpret Codex as ACP.

## Implementation follow-up: recursive deletion and settings

Official app-server documentation explicitly describes `thread/delete` as removing the persisted root **and spawned descendant threads**, rollout files and associated metadata before success. It does not establish a complete reviewable artifact scope, fork inclusion, handling of externally running descendants or partial-failure guarantees. The product now uses the existing shared tree review and a guarded Codex adapter, not Copilot's single-session deletion flow. [Codex deletion](deletion.md) owns exhaustive source/archive discovery, spawned-parent validation and explicit refusal of cross-project/incomplete/ambiguous-fork scope. Experimental ancestor filters are not used; real CLI removal has not been exercised.

Model/effort configuration uses `thread/resume`'s supported model/structured configuration overrides, constrained natively to `model_reasoning_effort` for the latter. Returned identity/cwd and effective values must match. Public documentation alone does not prove that an already-loaded idle thread applies those overrides; real installed-runtime acceptance is still pending. No global config-file mutation, prompt or automatic process restart is substituted. See the parent skill's policy questions.

## Async-question source review (0.164.0)

Read-only investigation used installed `codex-cli 0.164.0`, `codex app-server generate-ts --experimental --out <disposable-directory>`, and the matching official [`rust-v0.164.0` source](https://github.com/openai/codex/tree/rust-v0.164.0). No server connection, model request, configuration change or user-session mutation was performed. User-driven existing logs showed the async item in Default mode; they do not prove Nimrod's new answer-delivery path works natively.

- [`core/src/tools/handlers/request_user_input_async.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs) emits completed `AgentMessage` items with async delivery/questions and returns `{accepted:true}` immediately; it does not await a callback answer.
- Generated `v2/ThreadItem.ts`, `AsyncUserInputQuestion.ts`, `AgentMessageDelivery.ts` expose `{title,options}` on an `agentMessage`. This path is distinct from the RPC request schema reviewed above.
- [`tui/src/bottom_pane/async_questions/state.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/bottom_pane/async_questions/state.rs) constructs per-question IDs from `["request_user_input_async", sourceItemId, questionIndex]`, accepts labels or free text, and recognizes individual/legacy whole-item replies. Its auto-expiration and turn-end cleanup are client UX policies, not a blocking server request.
- [`context-fragments/src/answered_question.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/context-fragments/src/answered_question.rs) serializes the native `<send_user_message_question_reply>` JSON envelope; [`tui/src/async_question_reply.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/async_question_reply.rs) recognizes it for display/dismissal.
- [`tui/src/chatwidget/questions.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/questions.rs) uses ordinary input submission. [`tui/src/app/user_turn_submission.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/app/user_turn_submission.rs) selects active-turn steering versus idle turn start. Nimrod preserves its own no-retry/no-replay policy instead of adopting the native client's steer-race retry behavior.

This is reviewed native-client behavior pinned to one version, not a promise that the envelope is a stable public API. [Question contract](questions.md#async-follow-up-questions) owns Nimrod's deliberate retained-until-answered/ignored/superseded UX and remaining limitations.

## Distribution/authentication boundaries to revisit

- The TypeScript automation SDK requires Node; using app-server directly should avoid adding that runtime to Codex. The native launcher is source-implemented; installed launch and packaging behavior remain unverified.
- Prefer the user's installed/authenticated CLI and Codex-owned configuration. No credentials, OAuth tokens, configuration edits or automatic login/logout have been implemented.
- Official app-server documentation distinguishes local/open-source authentication integrations from commercial/hosted usage and recommends Sign in with ChatGPT for newer integrations. Re-read current supported authentication guidance before introducing a hosted/commercial flow or host-managed tokens; do not generalize the local desktop design into those products.
- WebSocket is not needed here and is documented as experimental. No listener, remote server attachment or network transport should be added to solve a local stdio requirement.
