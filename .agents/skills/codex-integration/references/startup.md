# Codex startup binding and cleanup diagnostics

**Status: source fix; post-fix native acceptance pending.** [Verification](../../features/references/verification.md#codex-startup-draft-binding) owns observed evidence and executed checks.

## Observed failure and cause

The user's Codex **0.164.0** trace shows successful `initialize` and `thread/start` responses for two new threads, followed by `thread/started` and MCP startup notifications. The frontend trace stays under a connecting identity and never requests `model/list`. There is no Codex RPC rejection in these captured startup responses. Native creation succeeded; this is not evidence of an authentication or sandbox-policy failure.

The shared `SessionDrafts.bindScope` and `deleteScope` whitelist in `src/pi/session-drafts.ts` still accepted only Pi/Copilot scopes. Main's synchronous identified callback therefore rejected the legitimate `codex:<JSON ID>` before publishing the bound backend identity. The existing native store already accepted Codex scopes. Fix the frontend namespace at both promotion and confirmed-removal boundaries, preserving provisional-only promotion, collision refusal, same-identity Resume and independent namespaces. Do not loosen Codex sandbox or approval policy.

## Secondary failure must not replace the first cause

Codex startup failure triggered owned shutdown; main's disconnect callback and launch catch could both report a later stop error into the same connection notice. A bare native `EPERM: Operation not permitted` could overwrite the initiating local-binding error.

- `src/codex/connection-failure.ts` formats the primary connection failure plus cleanup diagnostics separately. Main retains the first reason, reports startup failure immediately, and appends cleanup failure in Details rather than replacing the headline.
- Startup's catch owns startup shutdown. A normal established disconnect requests owned stop, while Close/deletion retain their own teardown/error ownership. No repeated automatic stop or prompt replay is added.
- If a transcript operation already owns the disconnection outcome, an independent failed-stop notice can explain retained native ownership without duplicating the primary error card.
- Native group failures now identify SIGTERM/SIGKILL/exit-observation phase and owned group ID. **Signal behavior, observed-exit requirements and retained reservations are unchanged.** EPERM is never converted into successful shutdown, ignored or used to authorize broader process searches/kills.
- `connection.disconnected`, `connection.disconnect_requested` and `connection.cleanup_failed` capture local causes/teardown requests through the existing opt-in sink and the same connection identity. These are diagnostics, not proof that a child exited or a prompt was accepted.

The exact native EPERM phase/permission mechanism was **not reproduced or established** by the existing trace, which lacks these new cleanup diagnostics. A post-fix signal/exit failure remains a separate acceptance/debugging question. Do not claim the namespace fix establishes native shutdown acceptance.

## Recovery and verification boundaries

The failed attempts created empty Codex history. Nothing here deletes those threads, migrates an unassigned draft into an arbitrary saved identity, changes credentials/configuration, automatically reconnects or repeats `thread/start`. The user can inspect/Resume existing history explicitly after updating; failed native reservations still require observed exit before replacement of that owner.

Authored, unrun regressions in `test/session-drafts.test.ts` exercise actual Codex promotion/deletion, same-identity binding, dirty-record callbacks, namespace isolation, collision preservation and unsupported-scope refusal. `test/codex-session.test.ts` now uses the **real shared draft store** in a sanitized 0.164-shaped startup fixture through model-catalog readiness, and checks original/cleanup error correlation without another thread or prompt. Earlier session fixtures stubbed identity binding and missed this cross-layer contract.

No new app-server connection, user-thread load/delete, paid request, build or app launch was performed for this fix. The user's existing log was inspected read-only. Native startup after this fix and any remaining EPERM require separate user acceptance; do not infer that from compile checks or authored fixtures.
