# Codex shared-daemon connections

**Status: source-implemented against Codex 0.169.0; new offline fixtures authored but unrun. Installed-runtime and native macOS/Linux acceptance pending.** [Verification](../../features/references/verification.md#codex-integration) owns executed evidence; [Codex guide](../../../../docs/codex.md) owns user behavior.

## Decision and motivating evidence

Codex uses its managed local app-server, not a separate writer per Nimrod conversation. The user's existing CLI thread failed Nimrod Resume with `already has an active writer` while CLI Resume worked. Read-only diagnostics showed the CLI daemon retaining the exact thread, then logging idle/no-subscriber runtime shutdown; the lock file was absent afterward and the user confirmed Nimrod Resume succeeded. That establishes the observed conflict/recovery, not native acceptance of this new transport.

The reviewed 0.169.0 [daemon README](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/app-server-daemon/README.md) and `src/lib.rs` establish:

- `codex app-server daemon start` is idempotent, reuses an existing server or starts Codex's managed package, and returns machine-readable `status` / `socketPath`. The managed server version can differ from the invoking CLI.
- `status` is `started` or `alreadyRunning` on a ready start. `socketPath` is authoritative; do not infer it by reading pidfiles, hashing a Codex home, or scanning processes.
- `src/client.rs` connects to that local socket and performs a WebSocket upgrade with `ws://localhost/`, then native JSON text records with no JSON-RPC version member. Nimrod does not negotiate compression, expose TCP listeners or set remote-control preferences.
- Shared clients inherit the daemon's startup environment. Per-client environment isolation is not provided; a newly opened terminal or a different project does not replace that environment.
- Daemon lifecycle is experimental. The daemon can restart for its own updates; a reconnect is explicit and never a prompt replay.

This is support for the managed local server, not a promise that a desktop app's separate private app-server shares it. Other independent writers can still conflict.

## Ownership and lifecycle

`src-tauri/src/codex_daemon.rs` owns bounded setup, Unix socket/WebSocket framing, ingress filtering, validated ordered writes and client closure. `codex.rs` retains exact project/window/token/generation ownership and deletion reservations. Conversation and catalog consumers each have an independent client connection to the same managed service.

- Runtime availability remains executable discovery only. Project/window initialization does not start the daemon. A permitted conversation connection or explicit history discovery invokes the installed CLI's supported `daemon start`; no provider work or thread Resume occurs just to discover history.
- Setup stdout/stderr each cap at 64 KiB; CLI setup has a 30-second deadline, the socket upgrade 5 seconds. Stop can cancel setup and terminate only the short-lived setup CLI, never a daemon PID/process group. Native `start_codex` confirms project readiness only after the socket upgrade, so frontend RPC deadlines do not include daemon setup.
- The daemon lifecycle CLI owns managed-package preparation and updater behavior. Nimrod does not install/pin/update a package itself or invoke `bootstrap`, `update`, `stop`, `restart` or remote-control enablement.
- Wire messages and frames cap at 16 MiB; the outgoing channel holds 32 records and each send has a 5-second deadline. Text JSON is ordered; Ping/Pong are transport-only. Binary/compressed records fail visibly, with no embedded-server fallback.
- Native ingress drops unrelated/global conversation notifications before frontend startup buffering. Foreign/global server requests and all catalog server requests are ignored without a fabricated rejection, because another client can own their callback. Exact bound-thread requests are tracked by original ID, bounded to 128; replies require a single-use pending ID on that exact client. `serverRequest/resolved` retires it.
- A daemon can replay approvals/questions before the Resume response. `CodexClient` waits for validated exact identity before presenting them, sharing the existing 128-record/1 MiB startup budget across notifications and requests. Resolution by another client, failed binding or disconnect suppresses stale pickers/replies. Existing scoped approval/question UI and native error handling remain unchanged after readiness.
- `SessionConnectivity.stop()` detaches and awaits release of this token's client resources. A bounded WebSocket close handshake is followed by socket drop; the task joins before native ownership is removed. Close, window close, quit, connection failure and Reload do not interrupt the thread, answer pending decisions or stop the daemon.
- `SessionReload.run()` retires pending local controls, replaces the client/controller, and resumes/rehydrates the same thread. The server runtime and active work may continue, including work initiated by another client. Preserve membership/drafts, fence retired callbacks and never replay any prompt, answer or configuration request. Pi/Copilot retain owned-runtime replacement through the same unchanged interface signatures.
- Composer Stop remains explicit native `turn/interrupt` for the exact active turn; it affects that shared thread's work. Identity, cwd, persisted encodings, prompt/client-ID adoption, dirty streaming, reader/focus behavior and optimistic Send policy are unchanged.

## Deletion and uncertain mutations

[Codex deletion](deletion.md) retains exact reviewed tree/project/lineage validation, local write fences and confirmed-only reconciliation. Its stopping phase now detaches affected Nimrod clients; it is not proof that a shared thread or external subscriber stopped. The explicitly reviewed native `thread/delete` owns teardown/removal of that tree, including shared activity. The daemon is never stopped to delete a tree.

A detached catalog cannot cancel a delete already sent to the daemon. Native bookkeeping retains an uncertain fence if a catalog is closed without an authoritative response to its tracked delete. Release/window teardown cannot clear that fence; no second delete is automatically sent. The fence lasts for this Nimrod host's lifetime and does not prove failure or exclude external clients. There is no new persisted quarantine or promise that restarting Nimrod resolves uncertainty. Inspect authoritative history before any later destructive retry; native acceptance of this boundary remains pending.

## Fixtures and acceptance

Authored fixtures: `src-tauri/src/codex_daemon_tests.rs` covers ready lifecycle response decoding, foreign ingress and catalog request isolation, pending-ID bounds, single-use replies, and a fake CLI/local WebSocket daemon remaining available after client detach. `test/codex-daemon-replay.test.ts` covers pre-response approval replay, another client's resolution, detach without answers/interrupt/replay, and shared startup bounds. Existing shell reload fixtures preserve exact-ID ordering, mounted drafts, sibling focus and no replay; Codex confirmation assertions qualify shared work. Native deletion fixtures cover retained uncertainty fences.

These fixtures are **unrun**. Required post-merge TypeScript/Rust compile evidence belongs in verification. No user-session probes, provider calls, tests, browser runs, builds or app launches were performed for this transport change. Before claiming native acceptance, verify CLI↔Nimrod attachment, active-stream/history races, replayed approvals and another client's resolution, Close/Reload/window quit, daemon restart/version mismatch, scoped deletion/unknown outcomes, and macOS/Linux behavior. Windows daemon transport remains unavailable in Nimrod; upstream Windows support alone is not acceptance here.
