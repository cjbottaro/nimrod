---
name: copilot-mode-acceptance
description: Finish getting Copilot Plan and Autopilot working in Nimrod. Use when asked how to finish plan/autopilot support, validate mode handoffs, test distinct planning/execution models, or resolve compaction confirmation and autonomous continuation limitations.
---

# Finish Copilot Plan and Autopilot support

## Purpose

Resume the unfinished acceptance and handoff work without repeating the initial
research or mistaking partial implementation for complete support.

Read repository `AGENTS.md`, `README.md`, the
[features skill](../features/SKILL.md), and these canonical references:

- [Architecture](../features/references/architecture.md)
- [Copilot SDK](../features/references/copilot-sdk.md), especially
  [verified mode API behavior and remaining handoff limits](../features/references/copilot-sdk.md#verified-mode-api-behavior-and-remaining-handoff-limits)
- [Model/thinking](../features/references/model-thinking.md)
- [Error presentation](../features/references/error-presentation.md)
- [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md)
- [User guide](../../../docs/copilot.md#plan-and-autopilot)

Those references own current behavior and protocol details. This skill owns the
resume plan and acceptance process, not a duplicate mode specification.

## Starting state: 2026-10-17

Source changes were merged locally:

- `d99bb75` / merge `ffca1e2`: intermediate Autopilot idle handling, explicit
  abort handling, completion deduplication and request-scoped plan decisions.
- `5785f4a`: optional plan feedback and Request changes, plus no-prompt probe
  findings and documented remaining limits.

Verify current source and dependency versions before acting; later work may have
changed this baseline. At the time of investigation Nimrod pinned SDK 1.0.22,
declaring CLI 1.0.98 compatibility and protocol 3.

Already implemented:

- Interactive/Plan/Autopilot selection through `SessionConfiguration` and
  `session.rpc.mode.get/set`.
- Confirmed-only Status-area mode; latest-wins queued configuration.
- Session-owned `onExitPlanModeRequest` decisions with exact advertised action
  validation.
- Optional feedback on approval and Request changes via
  `{approved:false,feedback}`. Cancel declines without sending feedback.
- Ordinary prompts sent once; no Nimrod-owned autonomous continuation loop.
- Intermediate root Autopilot idle does not complete work, cancel pending decisions
  or release queued configuration. Current source also recognizes an accepted
  root completion followed by sticky Autopilot idle; explicit aborted idle is terminal.
- Root/child separation and replay suppression.

Evidence and gaps:

- Mandatory post-merge TypeScript/Rust compile checks passed.
- New offline regression fixtures were authored but **not run**.
- User-authorized no-prompt probes used custom, separate in-memory session
  filesystems. No user conversations were loaded or deleted; no prompt,
  compaction or persisted plan selection was sent.
- Ordinary empty-session mode switches worked without follow-up flags.
  `status:"unchanged"` accompanied `modeApplied:true` and an actual mode change.
- A distinct-plan-model request on an empty session did not actually change the
  selected model. It is **not** evidence of successful model restoration.
- At this initial baseline, actual plan execution, sticky Autopilot completion,
  limit exhaustion, compaction confirmation and distinct-model handoff were
  unaccepted; subsequent ordinary-handoff evidence is linked below.
- No native GUI acceptance was established.

## Subsequent native evidence

The user has exercised the ordinary **Continue with Autopilot** path and observed
confirmed Autopilot mode plus initial implementation activity in Nimrod on macOS.
The existing trace corroborates approval and the native mode transition. This
narrows the original acceptance TODO; it does not close it. See the canonical
[evidence and remaining gaps](../features/references/verification.md#copilot-plan-and-autopilot).
The subsequent retained Plan review picker/banner and read-only decision card
still need native acceptance; the earlier inline UI was used for that observation.
A later captured completed run exposed the sticky-mode Working bug. The controller
and bridge now pair accepted root completion with subsequent idle, rather than
copying the SDK waiter's mode-only exclusion; correction fixtures and native gaps
are recorded in the same verification section. Do not rerun paid work or mutate the
user's conversation to validate this without explicit authorization.

## Unfinished problem

`mode.set` may return:

- `confirmation`
- `deferImplementation`
- `armInteractiveContinuation`

Nimrod currently reports these unsupported follow-ups and disconnects rather
than guessing. That is a safety fallback, not the desired finished UX.

Public API evidence:

- `mode.set` accepts `compactionDecision`, `restorePlanModel` and
  `planExitAction`.
- Compaction confirmation reports target model name, current tokens and target
  context limit.
- An upstream serialization fixture uses `"compact"` on `model.switchTo`.
  It does not prove all runtime values or the mode-transition call sequence.
- Low-level `session.rpc.ui.handlePendingExitPlanMode({requestId,response})`
  supports `response.deferImplementation`.
- The high-level callback's declared result type does not expose that field.
- The low-level request event includes request ID and plan-authoring model
  information omitted by the high-level callback.
- No verified canonical continuation payload or exact end-to-end sequence was
  established for `armInteractiveContinuation`.

Do not respond through both the callback and low-level event path. Determine
one response owner and verify event-interest registration/dispatch behavior.
Do not cast unsupported fields into the high-level callback type.

Important corrections to earlier discussion:

- “Not implemented in Nimrod” does not mean “impossible through the SDK.”
- An explicitly approved, distinct implementation turn is not accidental replay
  of the original prompt. It may be appropriate when the SDK handoff requires it.
- `session.task_complete` can report rejected/failed completion. Its name does
  not establish quiescence or unconditional success.
- Copying the SDK waiter's idle condition is source-level evidence, not proof
  that every sticky-mode/limit/abort lifecycle works in the native app.
- Plan feedback was useful adjacent work, but did not solve model restoration.

## Recommended next steps

Do not recommend shipping the advanced flows and waiting for users to discover
failures. Reproduce reachable limitations under controlled conditions first.

### 1. Run offline regressions when authorized

Check whether the current request authorizes tests. Repository policy makes
tests request-only; merely loading this skill is not authorization.

When authorized, use `mise run test`. Relevant coverage includes:

- `test/copilot-modes.test.ts`
- `test/copilot-sdk.test.ts`
- `test/copilot-bridge.test.ts`
- `test/fixtures/copilot-sdk.mjs`
- `test/shell.test.ts`

Use `npm run test:browser` when browser/scroll validation is authorized.
Fixtures catch integration bugs but do not establish real runtime behavior.
Do not write a fake that merely assumes the unproven handoff sequence.

### 2. Obtain authorization for bounded model-backed probes

The prior no-prompt probe authorization does not authorize model requests,
compaction, live user-session changes, builds or app launches.

Before making paid/model-backed requests, establish:

- Explicit permission for model-backed probes.
- User-selected budget/credit ceiling or bounded scope.
- Whether a separate compaction probe is authorized.

Ask focused questions using the repository-standard user-question tool. Do not
bundle unrelated permissions or invent a spending ceiling.

Use a disposable fixture project and isolated session storage. Do not resume,
modify or delete the user's conversations. Ensure provider/tool side effects are
bounded to fixtures and stop only probe-owned processes.

### 3. Exercise the normal paths first

Capture ordered native SDK events, outgoing calls and results for:

1. Plan -> Interactive implementation.
2. Plan -> Autopilot implementation.
3. Request changes, revise, then approve.
4. Stop during execution and between continuation steps.
5. Normal completion while mode remains sticky.
6. Failure and configured limit exhaustion.

Record exact SDK/CLI versions, configuration, whether prompts were sent and
actual terminal ordering. Never infer completion from final-looking prose.

### 4. Reproduce distinct planning/execution configuration

Prove that the planning turn actually used a different model, effort or context
tier before testing restoration.

Capture:

- Base execution configuration and effective planning configuration.
- Entry mode result and authoritative model/mode events.
- Exit-plan request, user choice and selected response transport.
- Deferred planning termination.
- Restoration request and authoritative reconciliation.
- How continuation is armed and the exact new-turn payload.
- Cancellation/error behavior at every boundary.

Do not equate `planBaseModelId` metadata or a successful empty-session mutation
with the distinct-model execution path.

### 5. Reproduce compaction confirmation separately

This may need sufficient fixture context and real compaction/model work.
Obtain explicit authorization first.

Establish:

- Accepted decision values.
- Cancel/decline semantics.
- Whether model or mode partially changes before confirmation.
- Whether the follow-up repeats `mode.set` with a decision or uses another API.
- Safe precondition handling after the confirmation.
- Event ordering and behavior if Stop/disconnect occurs.

If the runtime cannot expose enough evidence safely within the authorized scope,
record the precise blocker and seek upstream clarification rather than guessing.

### 6. Implement the verified handoffs

Reuse:

- Shared opaque `SessionConfiguration`.
- Shared session-owned decision presentation.
- Shared semantic Working/completion state.
- Existing Stop intent, session notices and optimistic Send policy.

Keep native mode, restoration and continuation sequencing in a narrow
Copilot-owned coordinator if the verified complexity warrants one.
Do not introduce a universal Plan/Autopilot protocol.

Every handoff must:

- Stay bound to the originating connection/session/request.
- Honor explicit approval and cancellation.
- Keep Stop available through transitional work.
- Preserve newer drafts, reader position, focus and navigation.
- Avoid concurrent/duplicate response owners.
- Submit an approved new implementation turn at most once.
- Never retry ambiguous delivery automatically.
- Avoid silently expanding permissions or enabling fleet behavior.
- Reconcile actual state after partial mutation.

### 7. Convert evidence to fixtures and perform native acceptance

Use sanitized captured sequences to extend offline tests, including errors and
cancellation races, then run authorized validation.

Coordinate requested builds with the user; building, publishing artifacts and
launching the app have distinct repository rules. Do not launch or restart the
user's app without approval.

Native acceptance should exercise the same matrix in Nimrod, including
background-session decisions, Working indicators, Stop, completion notifications,
draft preservation and reader position.

## Completion and documentation

Document results in the canonical Copilot reference and relevant user guide.
Update this skill's starting-state summary as work progresses.

Track each path as:

- Implemented and fixture-covered.
- Verified against the real pinned SDK/CLI.
- Accepted in native Nimrod on a named platform.
- Unsupported or unverified, with the exact reason.

Never collapse those categories into “supported.”

Until advanced handoffs are accepted, label them incomplete/experimental.
Prevent entry into known unsupported paths when they can be identified before
mutation; retain explicit safe failure for genuinely uncertain outcomes.

Follow the worktree/commit/local-merge policy and mandatory post-merge
`mise run check`. Retain branches/worktrees unless cleanup is requested.
No pushes, release publication or paid requests are implied by this skill.
