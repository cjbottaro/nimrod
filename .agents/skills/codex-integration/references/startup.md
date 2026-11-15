# Codex startup binding and cleanup diagnostics

**Status: source fix; post-fix native acceptance pending.** The draft-binding/error-correlation findings remain relevant. The owned-process teardown analysis below describes the former stdio transport; current Codex [daemon-client teardown](daemon.md) no longer signals an app-server group. [Verification](../../features/references/verification.md#codex-startup-draft-binding) owns observed evidence and executed checks.

## Observed failure and cause

The user's Codex **0.164.0** trace shows successful `initialize` and `thread/start` responses for two new threads, followed by `thread/started` and MCP startup notifications. The frontend trace stays under a connecting identity and never requests `model/list`. There is no Codex RPC rejection in these captured startup responses. Native creation succeeded; this is not evidence of an authentication or sandbox-policy failure.

The shared `SessionDrafts.bindScope` and `deleteScope` whitelist (then in `src/pi/session-drafts.ts`, now `src/session-drafts.ts`) accepted only Pi/Copilot scopes. Main's synchronous identified callback therefore rejected the legitimate `codex:<JSON ID>` before publishing the bound backend identity. The existing native store already accepted Codex scopes. The initial fix added Codex to the frontend whitelist; the subsequent [consumer-boundary extraction](../../features/references/consumer-interfaces.md#implemented-extraction-and-registration-boundary) removes harness enumeration from frontend and native draft consumers entirely. The [draft-scope contract](../../features/references/native-drafts.md#draft-scope-contract) preserves encodings, provisional-only promotion, collision refusal, same-identity Resume and independent namespaces. Codex sandbox and approval policy remain unchanged.

## Secondary failure must not replace the first cause

Codex startup failure triggered owned shutdown; main's disconnect callback and launch catch could both report a later stop error into the same connection notice. A bare native `EPERM: Operation not permitted` could overwrite the initiating local-binding error.

- `src/codex/connection-failure.ts` formats the primary connection failure plus cleanup diagnostics separately. The concrete `src/codex/connection.ts` owner retains the first reason, reports startup failure immediately through the shell's notice effect, and appends cleanup failure in Details rather than replacing the headline. Cleanup is bound to the originating token, including late completion after retirement; it cannot target or clear replacement state.
- Startup's catch owns startup shutdown. A normal established disconnect requests owned stop, while Close/deletion retain their own teardown/error ownership. No repeated automatic stop or prompt replay is added.
- If a transcript operation already owns the disconnection outcome, an independent failed-stop notice can explain retained native ownership without duplicating the primary error card.
- Native group failures identify SIGTERM/SIGKILL/exit-observation phase and owned group ID. Observed-exit requirements and retained reservations remain authoritative. The later teardown follow-up below distinguishes an already-exited leader from a live permission failure; EPERM alone is never treated as successful shutdown or used to authorize broader process searches/kills.
- `connection.disconnected`, `connection.disconnect_requested` and `connection.cleanup_failed` capture local causes/teardown requests through the existing opt-in sink and the same connection identity. These are diagnostics, not proof that a child exited or a prompt was accepted.

The original trace did not establish the EPERM phase/permission mechanism. Later user screenshots identify group SIGTERM denial; the kernel-source mechanism and guarded handling below address the exited-leader case without claiming the namespace fix established native shutdown acceptance.

## Owned-group teardown after graceful exit

Codex supervision drops stdin, drains the pipes and gives EOF a bounded shutdown
opportunity before signaling the owned group. A process can therefore already be
exited but unreaped when group SIGTERM is attempted. Apple's
[`kern_sig.c::killpg1`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c)
filters `SZOMB` members out of group signaling; zero eligible members can yield
EPERM even though the group contains the caller's exited child. This is a
kernel-source explanation consistent with the screenshot, not a live reproduction
or a claim that every EPERM has that cause.

`src-tauri/src/owned_process.rs`, shared by Codex and Copilot, handles this
narrowly:
- On signal EPERM, query/reap only the captured owned `Child`. A live child,
  failed exit observation or another signal error still returns failure and
  retains its reservation.
- Once leader exit is observed and reaped, return to **observation only**.
  Never send a subsequent signal to that numeric group ID, which can now recycle.
- Release only after a group existence probe returns ESRCH. Remaining members,
  persistent observation denial or a reused group keep ownership reserved.
  Bounded observation allows transient zombie descendants to disappear; a
  zero-signal EPERM is not an exit acknowledgement.
- An explicit retry with an already-reaped child is observation-only too. No
  process scans, unrelated signals, sandbox changes or Close-before-stop bypass
  were introduced.

Authored `owned_process.rs` fixtures cover a gracefully exited unreaped leader,
live-leader EPERM retention, and an exited/reaped leader with a remaining exact
fixture member that must survive the denied-stop path. These are **unrun** for
this change. Actual macOS Close and Linux behavior remain acceptance work.
The shared shell's disconnected Close/Delete fixtures exercise consumer routing,
not native permission behavior. [Verification](../../features/references/verification.md#registered-harness-application-contract)
separates this source change from runtime evidence.

## Recovery and verification boundaries

The failed attempts received native thread IDs; that does not prove durable history was created. Nothing here deletes those threads, migrates an unassigned draft into an arbitrary saved identity, changes credentials/configuration, automatically reconnects or repeats `thread/start`. The user can inspect/Resume existing history explicitly after updating; failed native reservations still require observed exit before replacement of that owner.

Authored, unrun regressions in `test/session-drafts.test.ts` exercise actual Codex promotion/deletion, same-identity binding, dirty-record callbacks, namespace isolation, collision preservation and unsupported-scope refusal. `test/codex-session.test.ts` now uses the **real shared draft store** in a sanitized 0.164-shaped startup fixture through model-catalog readiness, and checks original/cleanup error correlation without another thread or prompt. Earlier session fixtures stubbed identity binding and missed this cross-layer contract.

The follow-up `test/codex-connection.test.ts` exercises the actual lifecycle connection owner with real draft staging, coordinator-driven reconnect, previous-stop refusal, late retired startup, primary/cleanup failures and no prompt replay. Dependency fixtures guard the extracted shell/native boundary. [Verification](../../features/references/verification.md#integration-consumer-boundaries) owns their execution status.

No new app-server connection, user-thread load/delete, paid request, build or app launch was performed for this fix. The user's existing log was inspected read-only. Native startup after this fix and any remaining EPERM require separate user acceptance; do not infer that from compile checks or authored fixtures.
