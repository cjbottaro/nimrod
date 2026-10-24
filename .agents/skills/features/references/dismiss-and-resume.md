# Dismiss-and-resume workflow

**Status: official Nimrod UX contract; existing Copilot permission, question and plan review implementations.** This reference owns the shared interaction policy, not a universal harness API. Concrete integrations retain request/response and cancellation semantics.

## Purpose and scope

A pending agent decision must not trap the user behind a modal when the **Transcript** contains context needed to answer it. **Dismiss-and-resume** lets the user dismiss the decision's presentation, inspect the conversation, then reopen it from a persistent **Pending-action banner**. Here “resume” means reopen the presentation, not **Resume session**, reconnecting an agent, or continuing agent execution.

Use this workflow for agent-owned requests that can remain pending independently of modal visibility. Do not apply it automatically to ordinary one-shot pickers, destructive confirmations, or harness interactions whose supported dismissal semantics actually cancel/reject the operation. Do not invent a pending callback or response to simulate support.

## Interaction contract

1. Present eligible requests only in their owning selected session. Existing dialogs keep priority; background arrivals never summon a modal, navigate or steal focus.
2. **Escape** (or native dismissal) closes the active request picker without answering, denying, cancelling the turn or resolving its request promise. Release native modality and its backdrop/blur so the Transcript is readable and interactive again; restore the still-valid opener through the shared modal lifecycle.
3. Retain a non-dismissable, neutral, session-local **Pending-action banner** describing the waiting state and offering an explicit reopen button. Keep it available until the request queue empties or its owner is retired. Use the existing notice store/renderer, not an error, toast, transcript entry or new overlay. [Notice policy](error-presentation.md#presentation) owns placement, styling and announcement behavior.
4. Clicking the banner action reopens the pending decision UI only. It never submits an answer, reconnects, sends/replays a prompt or changes the composer. Eligibility and higher-priority modal checks still apply.
5. Preserve explicit dismissal across new arrivals and switching away/back. New arrivals may update the banner/count but must not reopen it. Undismissed work may be presented on explicit session navigation, without replacing an existing dialog.
6. For sequential requests, retain the same picker shell while advancing the oldest request after an explicit answer. Arrivals update counts without resetting the active filter, selection, context or nested input. Separate request kinds retain separate queues and banners rather than replacing one another.
7. In a nested answer/feedback modal, Escape dismisses only that child and returns to the retained parent picker without answering. A second Escape at the picker invokes dismiss-and-resume. Do not implement a global close-all gesture or claim child cancellation preserves an unsent custom answer.
8. Opening, dismissing, reopening and advancing preserve the composer draft and transcript reader/auto-follow intent. Stop, Close, disconnect and owner disposal are separate lifecycle boundaries: retire owned UI/callbacks and reject stale replies according to the concrete integration. Dismissal alone is never that boundary.

Use the shared retained palette and modal helpers; [command interactions](command-interactions.md#retained-decision-interactions) owns their presentation lifecycle. No new global modal manager or universal harness decision protocol is implied.

## Current examples

| Use case | Modal | Pending-action banner | Reopen action | Concrete semantics |
| --- | --- | --- | --- | --- |
| Copilot permission request | **Permission picker**; optional nested **Denial-feedback modal** | **Waiting for permission · N requests** (**Pending-permission banner**) | **Review requests** | [Permission choices and interaction](copilot-sdk.md#permission-choices-and-interaction) |
| Copilot agent question (harness-owned user-input request) | **Question picker**; optional nested **Custom-answer modal** | **Waiting for input · N questions** (**Pending-question banner**) | **Answer question** | [Questions and custom answers](copilot-sdk.md#questions-and-custom-answers) |
| Copilot exit-plan request | **Plan review picker**; nested plan feedback | **Waiting for plan review** (**Pending-plan banner**) | **Review plan** | [Plan review interaction](copilot-sdk.md#plan-review-interaction) |

Prefer **permission request** and **agent question** in discussion: permissions ask for authorization, while agent questions ask for an answer. “Harness-owned” identifies request authority; it does not imply that all harnesses currently implement this workflow. Completed **Question/answer cards** are read-only transcript records, not the pending interaction or its reopen control.

## Implementation and regression review

- `src/copilot/permission-interaction.ts`, `question-interaction.ts` and `plan-interaction.ts` own separate FIFO queues, explicit dismissal state, reopening, nested input and abort/stale-reply guards.
- `src/command-palette.ts` owns `startRetainedSelection`, Escape/native dismissal and guarded focus restoration; it does not own harness callback settlement.
- `src/main.ts` routes concrete SDK requests, publishes stable `pending-action` session notices and connects each reopen action to its owning interaction. Session navigation suspends/reveals presentation separately from pending requests.
- `src/copilot/session.ts` keeps waiting state until the decision promise settles; question-picker dismissal must leave that promise pending so it cannot enter the undefined-answer cancellation path.
- `test/copilot-questions.test.ts`, `test/copilot-permissions.test.ts`, `test/command-palette.test.ts` and `test/shell.test.ts` contain offline coverage for dismissal/reopen, queued arrivals, nested cancellation, ownership and guarded settlement. Review both keyboard Escape and native `cancel`, banner action routing, explicit dismissal across navigation, no decision/cancel writes on dismissal, and final banner retirement.

Source inspection and authored fixtures are not executed-test or native visual/focus acceptance. [Verification status](verification.md) owns executed evidence and platform acceptance gaps.
