# CLI customization reload

**Status: source implemented; fixture/native acceptance pending.** This owns synchronous CLI action control, distinct from [terminal launch forwarding](single-instance.md). User guide: [CLI actions](../../../../docs/cli-actions.md). [Verification](verification.md#cli-customization-reload) owns executed evidence. No discovery commands, session environment injection or broader agent-authoring workflow is part of this feature.

## Contract

`nimrod --action reload-customizations [--project DIRECTORY] [--json]` invokes the same combined operation as the palette/shortcut. The project defaults to caller cwd; explicit paths resolve against it and canonicalize before connecting. Only this named action is accepted. No arbitrary palette dispatcher, native command forwarding, JavaScript evaluation, prompt or harness lifecycle access.

The target must already have exactly one open project window and have registered frontend readiness. Never select by focused/most-recent window, open a project, start the application UI, raise/focus a window or resume a session. Missing/closing/unready/ambiguous targets fail without dispatch. Native requests bind a fresh ID to the owning window; only its completion command can settle that ID. Window close/shutdown retires readiness and pending receipts. Session activity/selection is irrelevant to routing.

The Bash launcher directly execs the native executable for action mode on macOS and Linux, preserving stdout/stderr/exit status. This bypasses Launch Services and Linux nohup. Native `main` handles action-client arguments before generating Tauri context or singleton election; no GTK/AppKit/application startup occurs. Normal directory launches retain their existing behavior and fire-and-forget completion semantics. Unknown actions/flags never fall through into app startup. Windows action transport is explicitly unsupported.

## Request/reply transport

A separate version-1 newline-delimited JSON Unix socket lives under `/tmp/nimrod-control-v1-<effective uid>/control.sock`. Both ends validate a non-symlink private parent owned by that effective user with no group/other access. The server creates it with 0700, socket 0600; its persistent `owner.lock` is opened no-follow/close-on-exec and held exclusively for endpoint lifetime. Only that owner removes stale/current sockets; never delete the lock inode. The short fixed path avoids macOS socket length limits. This endpoint neither changes nor reuses the macOS launch-election socket/wire format or Linux single-instance backend. It is same-user local control, not a remote API or isolation from trusted in-process plugins.

Server startup is optional to normal application startup: failures are logged and CLI requests fail rather than opening another instance. The listener and workers are async; at most eight requests execute concurrently. Each connection carries one action. Request frames are capped at 16 KiB, reply reads at 64 KiB. Read/write deadlines are bounded: server input 5s, completion 120s, reply write 5s; client connect 3s and exchange 135s. No phase retries. Endpoint shutdown retires waiters and releases its owner without waiting on the UI thread. The private directory/lock are retained.

Delivery/result states:

- `completed`: the target frontend settled the combined operation; inspect both subsystem results. `ok` requires templates applied, a card report and no subsystem error. Plugin warnings/errors are returned even when some cards loaded successfully.
- `notDispatched`: no action was sent to a window (unavailable server, invalid request/version, absent/unready/closing/ambiguous project, busy server).
- `unknown`: delivery/completion may have occurred (write/reply failure, event-delivery uncertainty, completion timeout, target close or shutdown). Do not replay automatically. A timeout does not cancel the underlying reload.

The CLI returns 0 only for completed success, 1 for partial failure/rejection/transport uncertainty, and native argument parsing returns 2. Launcher failures are nonzero. `--json` emits one action-response object on stdout; argument/launcher errors remain stderr. Human output summarizes template/card results and prints errors to stderr. CLI diagnostic fields are bounded to 2000 characters each with a truncation marker; full reload errors retain their existing in-app notice ownership.

## Shared execution/results

`reloadCustomizations` retains current coalescing and independent subsystem behavior, now returning `CustomizationReloadResult`. `card-plugin-loading.ts` returns the actual report/error associated with the load promise, not a later mutable status snapshot; superseded/disposed work returns an explicit error. Startup remains nonblocking. Existing palette/shortcut routes await and discard the result; CLI listener returns it to `complete_cli_action`. Invalid templates still preserve current UI while card refresh runs. Card errors do not suppress template application. The receipt is bound to the operation, never inferred from event emission, spinner state or a DOM change.

The frontend installs a window-targeted action listener before registering readiness at the end of project entry (including welcome-to-project transitions). It never navigates/focuses on receipt. Native expiry/closed-caller receipt failures are logged, not replayed or shown as duplicate operation notices. No new draft writes, session reloads, paid requests or user-session mutation.

## Code and fixtures

- `bin/nimrod`: action-mode direct exec; normal launcher unchanged.
- `src-tauri/src/cli.rs`: strict action argument grammar and canonical project identity; action requests never enter the launch queue.
- `src-tauri/src/cli_actions.rs`: allowlisted request/result types, per-user endpoint/client, bounded framing, project/ready routing and window-bound completion.
- `src-tauri/src/main.rs`: pre-runtime client interception, managed endpoint lifetime, project-close and app-exit cleanup.
- `src/customization-reload.ts`, `src/main.ts`, `src/card-plugin-loading.ts`: actual shared operation results, target-window listener/readiness/receipt.
- `src-tauri/src/cli_actions_tests.rs` and module-local Unix fixtures: exact/ambiguous target lookup, wrong-window/expired completion, close retirement, partial/error bounds, one endpoint owner, private parent, bounded frames, completed/lost fake-server replies.
- `test/cli-launcher.test.ts`: intercepted action exec on both platforms, exact args/stdio path; never starts the user's app.
- `test/shell.test.ts`: window-scoped receipts, coalescing, actual partial errors, retained draft/focus and no harness traffic through the real shell with mocked native boundary.
- `test/personal-card-plugins.test.ts`: actual cached/load/superseded/disposed result values.

Fixtures are disposable/provider-free and are not installed-runtime acceptance. No live endpoint probes, tests or app builds without explicit authorization; only the mandatory post-merge `mise run check` is automatic. Native macOS/Linux CLI-to-window delivery and installed-binary acceptance remain pending.
