# Codex experimental protocol and structured questions

**Status: source-implemented; fixtures authored but unrun. User-driven installed-CLI capture/native acceptance pending.** [Verification](../../features/references/verification.md#codex-questions) owns executed evidence. [Dismiss-and-resume](../../features/references/dismiss-and-resume.md) owns shared interaction behavior. This page owns Codex's request/response mapping, opt-in policy and limitations.

## Decision

The user approved `initialize.capabilities.experimentalApi: true` and a logs-first integration approach, with a minimally correct question handler before exposing interactive requests. This opts into experimental **protocol methods/fields**, not every CLI runtime feature. Nimrod does not call feature-flag mutation APIs, rewrite Codex configuration, select Plan automatically or claim a Codex Autopilot equivalent. Model/effort and sandbox/approval defaults remain harness-owned and unchanged.

The exact reviewed method is **`item/tool/requestUserInput`** from the local CLI 0.162.0 generated schema. Similar names in other documentation are not automatically treated as aliases. Actual tool availability in a particular model/mode is still unverified; a model asking a question in ordinary text does not prove a structured request occurred. Protocol opt-in alone does not make every experimental workflow available or implemented.

## Interfaces and code map

- `src/question-interaction.ts`: `QuestionPrompt`, `QuestionUi`, `QuestionAnswer` and `QuestionInteraction` own the actual shared retained picker/FIFO, nested input, dismissal/navigation, cancellation, counts and stale-child guards. Consumers are Copilot and Codex. There is no harness request schema, protocol reply, model configuration or native ownership in this port.
- `src/copilot/question-interaction.ts`: thin mapping of Copilot question/choice/freeform fields and its existing `{answer,wasFreeform}` contract. Its ordinary preview and interaction policy are preserved; this is responsibility extraction, not replacing Copilot semantics with Codex's.
- `src/codex/questions.ts`: strict, bounded decoding of the reviewed native schema and explicit reply validation. Unknown semantic fields/schemas are rejected for investigation, not guessed.
- `src/codex/question-interaction.ts`: maps one native batch to ordered shared question presentations and returns **one** keyed batch response only after every question is answered. Partly completed batches remain local until then.
- `src/codex/client.ts`: common request/turn ownership and abort machinery for approvals/questions, explicit unsupported errors and rejection diagnostics. `serverRequest/resolved`, terminal turns and disconnect cancel pending scopes; late answers never write stale replies.
- `src/codex/session-history.ts::CodexHistoryDiagnostics`: optional logging/interaction-failure port for the separate catalog. It reports unsupported catalog requests without creating a conversation; capture uses a catalog connection identity.
- `src/codex/session.ts`, `src/main.ts`: concrete session hook composition, session-local question banner/input attention and notifications, unsupported-interaction notice/details and raw logging. No unknown-request modal or arbitrary JSON approval editor.

## Native mapping

A request contains `threadId`, `turnId`, `itemId`, `questions`, `isBlocking`, and nullable/deprecated `autoResolutionMs`. Each question has `id`, `header`, `question`, `isOther`, `isSecret`, and nullable options (`label`, `description`).

- Support **1–3 non-secret questions per RPC**, one explicit option label or free-text answer per question. Null options mean free text; otherwise custom text is available only when `isOther` is true. No fabricated multi-select behavior.
- Return `{ answers: { [questionId]: { answers: [exactUserAnswer] } } }`. Native labels/IDs and entered whitespace are preserved; answers are not ordinary prompts, steering messages or permission decisions. IDs such as `__proto__` remain ordinary own keys, not prototype mutation.
- Validate exact requested answer keys, one non-empty answer per question, and offered labels when custom text is forbidden. No partial, empty, default-selected or timeout-generated reply.
- Keep `isBlocking` and timeout metadata in the native log; do not guess activity state or auto-resolve from `autoResolutionMs`. Even a nonblocking request retains explicit pending input until Codex resolves it or the user answers.
- Field bounds are explicit refusal, never truncation: 128-character question IDs, 512-character headers, 64 KiB question/free-answer text, at most 100 options, 8 KiB option labels and 16 KiB descriptions. Empty/duplicate IDs or labels, empty option arrays, unknown semantic fields and malformed values produce a diagnostic/error reply.
- **Secret input is unsupported** in this baseline. `isSecret: true` is rejected before any ordinary input dialog opens or answer is collected. Adding it needs a masked/private input and logging policy, not silently reusing a textarea. Unknown MCP elicitation, additional-permission callbacks, dynamic host tools and authentication requests remain explicitly unsupported.

## Presentation and lifetime

Each question uses the existing retained palette; free text uses the shared `Dialogs` child modal. Escape at the child returns to the parent; Escape at the picker dismisses only presentation. The session's **Waiting for input · N questions** / **Answer question** banner remains, including across navigation and new arrivals. Composer drafts, transcript reading/follow intent and unrelated dialogs are unchanged.

A batch is queued synchronously so another RPC cannot interleave between its questions. Completed answers are held while remaining questions are presented; there is no Back/edit-previous-answer UI yet. Dismissing retains the remaining batch. Abort/Stop/Close/disconnect/server resolution retires it without sending partial answers. Background arrivals do not summon a modal, select a session or steal focus. Approval and question queues/banners remain separate.

## Fallbacks and logs

Unknown native **items/tools** retain generic/raw cards. Unknown **notifications** are captured when logging is enabled but need not produce transcript rows. Unknown/malformed/unsupported **server requests** get an explicit RPC error and a session-local notice with method, request ID and reason. Never invent an answer, grant or generic executable response. Secret/foreign-thread requests are not presented as answerable ordinary questions.

The opt-in transcript sink captures the incoming native packet before dispatch and outgoing RPC results/errors as `response` records. The separate catalog uses `catalog.receive`, `catalog.request`, `catalog.response` and `catalog.interaction.rejected` with a `catalog:<connection ID>` identity; its independent failure notices are window/history-owned, while conversation failures remain session-local. `interaction.rejected` adds a diagnostic correlation marker; it does not replace the raw packet. This includes unsupported requests. Logging remains best-effort, non-blocking, off by default and full-content—not a durable audit log or a redacted record. No tracing activates provider work or backfills earlier events.

For user-driven capture, enable **Global Settings → Diagnostics → Transcript debug logs** before making a new connection. Start a new Codex session or explicitly Close/Resume an old one so the new initialization capability is sent. Preserve `codex/codex/<UTC-date>*.jsonl` segments and provide approximate time/session ID. Useful payload methods are `item/tool/requestUserInput`, `serverRequest/resolved`, and any unsupported request; correlate answers/errors by RPC ID plus connection ID. A prompt asking for choices may still yield plain assistant text if the native tool is not available in that mode—record what happened rather than declaring the UI broken or emulating Plan.

No live prompt, mode change, app launch, user-session load or build was performed to implement this path. The user will trigger their own interaction after deploying the changed source.

## Fixtures and remaining acceptance

`test/codex-questions.test.ts` covers batched native IDs, retained actual palette, descriptions/freeform restrictions, nested cancellation, blank/oversized input, background/abort/stale child replies, strict schema/secret/duplicate handling and own-key safety. `test/codex-client.test.ts` covers opt-in handshake, exact response shape, scope, resolution/terminal/disconnect and explicit unsupported diagnostics. `test/codex-session.test.ts` asserts raw request/response/rejection capture without a new prompt. Existing Copilot question fixtures remain the shared UI regression base.

Fixtures are **authored unrun**. Installed CLI payload/flags, default-versus-Plan availability, native WKWebView/WebKitGTK focus/layout and timing, nonblocking request behavior, timeout expectations and actual log persistence still need acceptance. Changes are not a blanket experimental-feature compatibility promise. Use observed packets to add narrow adapters or improve cards while preserving request authority and lifetime.
