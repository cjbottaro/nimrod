# Reviewed Codex protocol evidence

## Local source, not a live integration test

The initial review used `/opt/homebrew/bin/codex` reporting `codex-cli 0.162.0`; the subsequent async-question review below used installed `0.164.0`.
The implementation reviewed local generated types produced by:

```sh
codex --version
codex app-server generate-ts --out <disposable-directory>
```

No `--experimental` flag was used. The generator's help itself calls generation experimental; generated presence is not proof that every described feature is enabled, production-stable or available on older CLIs. Only schema generation and help/version inspection were performed—no app-server connection, authentication change, thread open/list/load, prompt or user-data operation. Generated output was inspection material, not a new dependency or a vendored full protocol tree. `src/codex/protocol.ts` is explicitly a hand-maintained consumer subset, with runtime validation of identity/lifecycle/page shapes. Validate incoming item-specific fields in the future projector rather than trusting TypeScript casts.

## Distrobox cwd-filter disagreement (0.169.0)

During the user-requested Linux/Distrobox investigation, the supported daemon
lifecycle command returned `alreadyRunning`, with CLI/managed app-server both
0.169.0. A separate disposable WebSocket client performed initialize/initialized,
non-archived interactive listings for `/home/cjbottaro/Projects/nimrod` and
`/var/home/cjbottaro/Projects/nimrod`, an unfiltered all-source metadata listing,
and one exact `thread/read {includeTurns:false}`. Both filtered requests returned
the same five IDs with `/home/...` cwd. The unfiltered inventory and exact read
reported those IDs under `/var/home/...`. Thus successful filtered discovery was
not reliable evidence for the later exact saved-project guards. No thread was
started, resumed, prompted, renamed, configured, interrupted or deleted; the
client detached without stopping/restarting the daemon. This was a targeted
metadata probe, not native Nimrod acceptance or a guarantee about other Codex
versions. Existing user error reports identified the native Resume project guard
and exact deletion-tree project guard; raw Resume response paths remain unprobed.

Matching official 0.169.0 sources distinguish stored metadata from effective
runtime config: [`thread_processor.rs`](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/app-server/src/request_processors/thread_processor.rs)
constructs `Thread` from stored cwd and `ThreadResumeResponse.cwd` from runtime
configuration; [`thread_lifecycle.rs`](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs)
uses the running thread's config snapshot for warm Resume. This does not prove
an already-running thread accepts a different cwd override. The implemented
[project/runtime contract](daemon.md#saved-project-identity-versus-runtime-cwd)
preserves literal saved membership and separately verifies runtime paths.

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
| `v2/ThreadListParams.ts`, `ThreadListResponse.ts` | Cwd/provider/source filters, nullable next cursor. The later [0.169.0 cwd probe](#distrobox-cwd-filter-disagreement-01690) disproves assuming literal project partitioning from the cwd filter. Nimrod uses unfiltered saved metadata plus local exact cwd/subagent checks. Default source scope is interactive; empty modelProviders includes all providers. |
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

The original model/effort path used `thread/resume` overrides. The user reported `no rollout found for thread id …` when changing the model in a new session: a loaded runtime does not imply saved rollout availability, so Resume is the wrong mutation path.

A targeted read-only review generated experimental TypeScript from the installed **Codex CLI 0.169.0** (`codex app-server generate-ts --experimental --out <disposable-directory>`). `ThreadSettingsUpdateParams` exposes `threadId` plus optional `model` / `effort`; `ThreadSettingsUpdateResponse` is empty. `ThreadSettingsUpdatedNotification` carries `threadId` and `threadSettings`, including `cwd`, `model` and `effort`. Nimrod now sends the live update and requires both acknowledgement and matching native settings notification, in either order. The native gate permits only one model/effort field and rejects policy/cwd injection. No Resume fallback, prompt, rename, global config write or automatic restart is substituted. This is a targeted schema review, not a full runtime upgrade audit or execution evidence: no app-server was connected and no model request or user-session mutation was performed; installed-runtime notification/application acceptance remains pending.

## Async-question source review (0.164.0)

Read-only investigation used installed `codex-cli 0.164.0`, `codex app-server generate-ts --experimental --out <disposable-directory>`, and the matching official [`rust-v0.164.0` source](https://github.com/openai/codex/tree/rust-v0.164.0). No server connection, model request, configuration change or user-session mutation was performed. User-driven existing logs showed the async item in Default mode; they do not prove Nimrod's new answer-delivery path works natively.

- [`core/src/tools/handlers/request_user_input_async.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs) emits completed `AgentMessage` items with async delivery/questions and returns `{accepted:true}` immediately; it does not await a callback answer.
- Generated `v2/ThreadItem.ts`, `AsyncUserInputQuestion.ts`, `AgentMessageDelivery.ts` expose `{title,options}` on an `agentMessage`. This path is distinct from the RPC request schema reviewed above.
- [`tui/src/bottom_pane/async_questions/state.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/bottom_pane/async_questions/state.rs) constructs per-question IDs from `["request_user_input_async", sourceItemId, questionIndex]`, accepts labels or free text, and recognizes individual/legacy whole-item replies. Its auto-expiration and turn-end cleanup are client UX policies, not a blocking server request.
- [`context-fragments/src/answered_question.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/context-fragments/src/answered_question.rs) serializes the native `<send_user_message_question_reply>` JSON envelope; [`tui/src/async_question_reply.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/async_question_reply.rs) recognizes it for display/dismissal.
- [`tui/src/chatwidget/questions.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/questions.rs) uses ordinary input submission. [`tui/src/app/user_turn_submission.rs`](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/app/user_turn_submission.rs) selects active-turn steering versus idle turn start. Nimrod preserves its own no-retry/no-replay policy instead of adopting the native client's steer-race retry behavior.

This is reviewed native-client behavior pinned to one version, not a promise that the envelope is a stable public API. [Question contract](questions.md#async-follow-up-questions) owns Nimrod's deliberate retained-until-answered/ignored/superseded UX and remaining limitations.

## Rename protocol review (0.164.0)

The Rename session implementation additionally read the existing local 0.164.0
generated `ClientRequest.ts`, `v2/ThreadSetNameParams.ts`,
`ThreadSetNameResponse.ts` and `ThreadNameUpdatedNotification.ts` from the
async-question review. They expose `thread/name/set {threadId,name}`, an empty
object result, and `thread/name/updated {threadId,threadName}`. No new generator,
server connection or user-session mutation was needed. The [shared naming
contract](../../features/references/session-naming.md) owns the concrete
implementation, native binding/deletion guards and remaining runtime acceptance.

## Slash-command source/schema audit (0.164.0)

The [complete command audit](../../slash-commands/references/codex-audit.md)
reused the existing matching official source and generated experimental types,
without launching Codex or a server, reading user sessions, running commands or
making model requests. It records all 65 enum commands, serialization aliases,
feature/platform/busy rules, dynamic command families and 178 schema methods.
The development-only fingerprint snapshot/script supports future upgrade diffs;
it is not a runtime catalog or API allowlist.

New consumed report schemas: `ThreadReadParams/Response` (metadata only),
`ListMcpServerStatusParams/Response`, `McpServerStatus/Detail`,
`ThreadBackgroundTerminalsListParams/Response`, `SkillsListParams/Response/Entry`,
`SkillMetadata`, `HooksListParams/Response/Entry` and `HookMetadata`. Cwd and
thread identity remain exact, pagination must complete or fail, and skill/hook
reports deliberately omit native use/configuration/trust interactions.

`ThreadCompactStartParams` accepts only `threadId`; its empty response means
`Op::Compact` was submitted, not completed. Matching native
`app-server/src/request_processors/thread_processor.rs` and
`core/src/tasks/compact.rs` establish that manual compaction emits a native turn
and may use provider work. V2 emits a canonical `contextCompaction` item; the
legacy context-compacted notification is not used for confirmation. Nimrod waits
for that item's identified turn and its terminal outcome in either RPC/event
order, fails on native errors/interruption, and reports missing confirmation as
unknown without replay. Native execution/stop/usage behavior remains unaccepted;
no live compaction was performed.

## Untouched native-session interoperability (0.164.0)

The user-authorized installed-runtime probe and its exact safety/coverage limits
are recorded in [verification](../../features/references/verification.md#codex-native-untouched-session-probe).
It demonstrates that runtime existence, durable Resume and ordinary history
discovery are three separate contracts, including for sessions created by the
native CLI rather than Nimrod.

Matching official source:
- `tui/src/app_server_session.rs::thread_start_params_from_config` selects
  paginated history for persistent native sessions. Native naming sends the same
  `thread/name/set` API used by other clients.
- `thread-store/src/local/pending_thread_metadata_tests.rs::
  idle_shutdown_clears_pending_thread_metadata_without_materializing` covers an
  untouched thread remaining absent from saved storage after shutdown.
- `app-server/tests/suite/v2/thread_resume.rs::
  thread_resume_rejects_unmaterialized_thread` explicitly rejects Resume before
  rollout materialization in both legacy and paginated modes, with or without turns.
- `app-server/tests/suite/v2/thread_name_persistence.rs::
  named_empty_paginated_thread_resumes_after_restart` and
  `thread-store/src/local/update_thread_metadata.rs` establish that naming an empty
  paginated thread persists its recorder before metadata acknowledgement. No
  synthetic user turn is needed.
- `state/src/runtime/threads.rs::push_thread_filters_with_preview` adds
  `threads.preview <> ''` for ordinary non-archived, non-section-scoped listing.
  A saved name alone does not supply a message preview. This explains why a named
  zero-message thread can resume by exact ID yet remain absent from ordinary
  native/app-server Resume discovery; `useStateDbOnly` does not bypass this filter.
- `tui/src/app/exit_summary.rs` distinguishes client disconnect from embedded
  shutdown and prints a reconnect command for shared-server tasks. That printed
  command is not evidence that an unmaterialized thread can actually resume:
  the controlled shared-server probe reproduced the native reconnect failure.

Integration constraints: do not classify a native session as nonexistent merely
because it has zero messages or is missing from the ordinary catalog. Conversely,
a loaded ID/precomputed rollout path and a shared-server reconnect hint are not
saved-history evidence. Nimrod-private untouched metadata/replacement can preserve
a local placeholder but cannot provide native CLI interoperability for an
arbitrary untouched external thread. Merely switching to the shared daemon does
not fix the demonstrated Resume rejection. The user's plain-native-create →
no-Send → quit → Nimrod requirement remains constrained by upstream persistence/
Resume semantics in this version. Any broader saved-empty discovery needs a
supported native API contract rather than private SQLite/filesystem inventory or
fabricated history. No automatic rename, replacement or upstream change was
implemented by this investigation.

## Existing upstream issues

Authenticated read-only `gh` searches of `openai/codex` found these existing open
issues. Issue reports and third-party comments are corroborating context, not
maintainer guarantees or evidence that a suggested workaround works on 0.164.0.

| Issue | Relevance / distinction |
| --- | --- |
| [#42099 — 0.151.0 regression: app-server thread/start no longer persists zero-turn threads, breaking resume](https://github.com/openai/codex/issues/42099) | Closest persistence/restart match: start returns an ID, shutdown precedes first turn, native Resume fails with no rollout. Reporter contrasts 0.150.1 with 0.151.0 and requests durable start or an explicit persistence API. Open, with no comments when checked. |
| [#43053 — Resuming a fresh thread from a second client fails before its first message](https://github.com/openai/codex/issues/43053) | Closest cross-client attachment match. Report and follow-up discuss 0.153.4 paginated lineage/naming failures. The reporter's `excludeTurns:false` workaround is version/sequence-specific; Nimrod does not use a history read/resume to force materialization. |
| [#48370 — Resume picker hides app-created threads with history when preview is empty](https://github.com/openai/codex/issues/48370) | Same listing filter as the probe: `threads.preview <> ''`. Its reproducer has real delegated history but no ordinary user event, rather than a truly untouched thread. It explicitly discusses named-empty visibility. An empty preview is neither absence of history nor deletion/replacement authority. |
| [#55770 — app-server: metadata-only pre-input state query for unmaterialized threads](https://github.com/openai/codex/issues/55770) | Related API-contract request on 0.163.0 macOS/Linux. Explicitly separates a non-materializing state query from #43053's attachment/materialization issue; unavailable history is not proof of no input. |

Broader searches included exact no-rollout text, first-user-message,
zero-turn/unmaterialized and empty-preview/named-empty variants, plus issue bodies
and relevant comments. No new issue, comment, reaction or subscription was posted.
These matches are sufficient to track the known mechanisms; no claim was made
that every superficially similar desktop error has the same cause or that a
separate exact duplicate of the named-zero-message probe was found. Current
Nimrod behavior and the retired private workaround are documented by the
[parent integration contract](../SKILL.md#untouched-session-persistence-anomaly).

## Distribution/authentication boundaries to revisit

- The TypeScript automation SDK requires Node; using app-server directly should avoid adding that runtime to Codex. The native launcher is source-implemented; installed launch and packaging behavior remain unverified.
- Prefer the user's installed/authenticated CLI and Codex-owned configuration. No credentials, OAuth tokens, configuration edits or automatic login/logout have been implemented.
- Official app-server documentation distinguishes local/open-source authentication integrations from commercial/hosted usage and recommends Sign in with ChatGPT for newer integrations. Re-read current supported authentication guidance before introducing a hosted/commercial flow or host-managed tokens; do not generalize the local desktop design into those products.
- WebSocket is not needed here and is documented as experimental. No listener, remote server attachment or network transport should be added to solve a local stdio requirement.
