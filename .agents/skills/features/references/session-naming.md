# Rename session

**Status: source-implemented; new fixtures authored, unrun. Installed-runtime and native macOS/Linux acceptance remain pending.**

## Consumer contract

The selected-session palette action, configurable `rename` keybinding (`primary+shift+r` by default),
and native session-row menu share `runSessionRowAction` / `renameSession` in
`src/main.ts`. A row action captures that row, never the later selected session.
Every `HarnessSession` must supply `naming: SessionNaming`
(`src/session-naming.ts`) with `rename(name): Promise<void>`. The registry
preserves the live port, including prototype implementations. Unsupported adapters
must reject explicitly rather than omit the port, succeed silently or persist a
Nimrod-only alias. This is a naming consumer interface, not a harness protocol.

## Interaction and lifetime

- Require an open, connected session outside startup/Close/Reload/deletion locks.
  Disconnected targets report **Resume this session before renaming it** in their
  session notice; this action never launches a runtime or changes selection.
- Reuse `Dialogs.input`, its shared modal shell/motion, current title prefill and
  **Rename session** submit label. Opt into `selectPrefill` so the focused input
  selects the entire current name on open; typing replaces it immediately.
  This is actual editable text, not a placeholder; other input dialogs retain
  their existing selection behavior. Cancel/Escape does nothing. Accepted input is
  trimmed; blank, multiline and ASCII-control-containing values reject locally.
  Submitting the prefilled title still sets an explicit harness name, even if the
  title was originally inferred from a message.
- Close the modal immediately at submission; RPC results do not gate dismissal,
  input/focus restoration or subsequent drafting. The displayed durable name is
  authoritative metadata, not an optimistic local alias: results/events reconcile
  it through each integration's existing title publication. This narrow
  authority requirement does not permit gating ordinary interaction feedback.
- Revalidate the captured native token and live target after the modal. Replaced
  or disconnected owners cannot apply that old input to a fresh runtime.
  Coalesce duplicate shell invocations while input/rename is pending. No automatic
  retries, rollback, prompt fallback, composer mutation, navigation, recency,
  transcript reset or new storage schema. Existing conditional layout saves
  persist real title changes, never per-token activity.
- Errors use a stable, session-owned **Rename session** notice; successful explicit
  retry resolves it. Background errors remain with that session. No new banners,
  global alerts or transcript cards. Losing acknowledgement remains uncertain,
  not proof the native mutation failed.
- Copilot/Codex count an in-flight rename as pending destructive work for the
  existing Close/Reload review policy. Pi already tracks `set_session_name`.
  Live name events outrank a stale result; response application is synchronous
  in the ordered channel, before later events.

## Named creation via native rename

[Session creation](session-creation.md) owns the form, capabilities and preflight contract. Pi keeps native `--name`; Copilot/Codex adapters accept `SessionRequest.initialName` for new saved sessions, then call the same `CopilotSession.rename` / `CodexSession.rename` operations as explicit Rename. Copilot's `copilotSessionName` helper shares normalization and the 100-Unicode-code-point limit across both paths; Codex uses the shared nonempty/single-line/control-character validator.

The adapters consume the requested name once before any launch await and bind the naming attempt to that exact token/session after successful native initialization. Startup completes and `owner.starting` clears before the naming request, which is dispatched without gating drafting/Send or waiting to close the creation modal. Pending native rename still counts as destructive work for Close/Reload review. Replies/events use the existing ordered native-title revision logic, not a local name override; subsequent authoritative names can supersede an earlier name acknowledgement.

A connected rename rejection does not enter startup cleanup or stop/delete/recreate the new session. Its `Name new session` notice uses the shared session-owned `rename` occurrence, explains that creation succeeded but naming is unconfirmed, retains native details and directs an explicit Rename retry. Successful explicit Rename resolves that same occurrence. Transport-loss/disconnection keeps the native connection failure as the single presentation instead of duplicating a derivative naming notice. Retired/replaced/closing/deleting/reloading owners suppress late naming feedback. No callback selects a session, changes recency/drafts or reapplies the name.

The one-shot creation name is not persisted as pending work. Initial failure/uncertain delivery, explicit reconnect, Reload and exact-ID Resume never retry it or rename a replacement. A runtime ID and a naming acknowledgement remain distinct from saved-history/discovery evidence; Codex's empty-thread list limitations still apply.

Fixtures: registry/type preflight assertions; `test/codex-connection.test.ts` covers one-shot ordering, readiness, native rejection, retired completion and exact reconnect; shared shell fixtures cover Copilot/Codex native shapes, held naming with editable drafts, rejection without startup cleanup, explicit retry resolution, no prompt and no Reload replay. Browser named-Copilot fixtures use the production bridge with an offline SDK. These additions are authored, unrun; only the required compile check is automatic.

## Concrete mappings

| Integration | Operation / semantics |
| --- | --- |
| Pi | Existing native `set_session_name {name}`; public `PiSession.rename` shared with its existing naming path. Apply successful acknowledgement synchronously. Temporary names are runtime-only; naming alone need not create saved history. |
| Copilot SDK | New narrow bridge `rename` operation calls the pinned SDK's experimental `session.rpc.name.set({name})`, then `name.get()` for the authoritative returned name. SDK documents 1–100 characters; frontend, bridge and Rust enforce the limit. Native `session.title_changed` events continue to reconcile names. This is distinct from the existing harness-owned `/session rename` command, which is not substituted or intercepted. Missing/unsupported SDK/runtime methods surface errors without fallback. |
| Codex | `thread/name/set {threadId,name}`, empty-object response and `thread/name/updated {threadId,threadName}`. Native allowlist admits this one operation, validates name/ID, requires the writer's bound thread, rejects catalog use and observes deletion reservations. No raw file writes. |
| Retained ACP | Explicit unsupported rejection; no generic ACP rename API is assumed. |

Copilot's wire shapes are from pinned SDK 1.0.22 generated `NameSetRequest`,
`NameGetResult` and `SessionRpc.name` definitions; see the SDK integration reference.
Codex shapes were read from the existing local 0.164.0 generated protocol material;
[protocol evidence](../../codex-integration/references/protocol-evidence.md) owns
source provenance. No live session probes or provider work were performed.

## Coverage and remaining acceptance

Authored, unrun fixtures cover:
- `test/session-naming.test.ts`: normalization and control/multiline rejection.
- `test/harness-contract.types.ts`, registry fixture: required executable naming
  port and preservation across registration/class binding.
- `test/shell.test.ts`: row-targeted background rename without selection, recency,
  draft or process effects; prefilled/cancelled/invalid/successful palette input;
  disconnected notice without reconnect.
- `test/session.test.ts`, `test/copilot-sdk.test.ts`,
  `test/codex-session.test.ts`: native operation shape, ordered title application,
  newer-event precedence, rejection, and no prompt/command fallback.
- `test/copilot-bridge.test.ts`: production bridge with offline SDK name fixture.
- Rust Copilot/Codex validation and Codex deletion-gate fixtures: name limits,
  exact bound identity, catalog refusal and deletion reservation.

Only the mandatory post-merge compile check is automatic; it does not execute
these fixtures. Native row-menu delivery, modal focus/appearance, persisted
history after Close/Resume, runtime API acceptance and platform behavior need
separate requested validation. See [verification](verification.md) for execution evidence.

User guide: [Rename a session](../../../../docs/sessions.md#rename-a-session).
