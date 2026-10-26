# Rename session

**Status: source-implemented; new fixtures authored, unrun. Installed-runtime and native macOS/Linux acceptance remain pending.**

## Consumer contract

The selected-session palette action, configurable `rename` keybinding (no default),
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
  **Rename session** submit label. Cancel/Escape does nothing. Accepted input is
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
