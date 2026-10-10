# Single-instance startup and terminal forwarding

Human guide: [Terminal launches](../../../../docs/workspace-sessions.md#terminal-launches).
Related: [architecture](../../../../docs/architecture.md#terminal-entry-point),
[projects/sessions](projects-and-sessions.md), [pop-out focus](pop-outs.md).

## Code map

- `bin/nimrod`: canonical Bash directory launcher; macOS `open -n -a … --args --workspace …`, Linux executable launch. Returns on OS acceptance, not routing/focus completion.
- `src-tauri/src/single_instance.rs`: macOS pre-runtime lifetime lock, synchronous Unix listener binding, bounded forwarding IO and owner-only cleanup. The core is also compiled into Unix fixture tests; this does not replace Linux's production backend.
- `src-tauri/src/main.rs`: parses/validates the initial request, elects/forwards before constructing Tauri, starts the listener after managed state exists, then creates the initial window and enables the existing request queue. Explicit `RunEvent::Exit` cleanup is required because Tauri `App::run` exits the process without running Rust destructors.
- `src-tauri/src/cli.rs`: canonical argument parsing and one ordered, setup-gated router worker. This queue is not an inter-process election mechanism.
- `src-tauri/src/workspace_windows.rs`: directory/window reuse, creation and focusing; no Pi launch/resume.

## Failure and invariants

The pinned `tauri-plugin-single-instance` 2.4.5 macOS backend connects, unlinks a
missing/refused endpoint, then binds its listener in an asynchronously spawned task.
Two cold launches can both continue as full apps; a loser can unlink a live listener,
and either process's unconditional exit cleanup can remove the other's endpoint.
This is a concrete source/socket race, not a confirmed native reproduction of the
reported failure. Separate full processes would explain native Command–backtick not cycling their
project windows. Do not replace native cycling with a frontend key handler.

The macOS replacement:

1. Opens a persistent lock file and attempts nonblocking exclusive `flock`.
2. Probes/forwards to the current listener, including an older running build that
   does not hold the new lock. Successful forwarding returns before creating any
   Tauri runtime/UI. Secondary processes do not perform socket cleanup.
3. Only an owner with no reachable listener may remove a stale socket and bind
   synchronously. The ownership lock remains alive until process exit, covering
   both startup and shutdown. A secondary observing a lock without a listener waits
   for listener publication or owner exit, with a 10-second limit; it never falls
   back to a second UI on timeout or unexpected errors.
4. The primary listener starts reading after Tauri's managed state is installed.
   Incoming requests remain behind `CliRequests.ready` until the initial project
   binding is complete. One off-main-thread reader preserves receive order; routing
   still uses the existing ordered worker.
5. Native Exit stops the reader and removes the owner's socket while retaining the
   lock until actual process exit. Drop provides the same idempotent cleanup for
   setup failures/tests. A killed process leaves a stale socket but the kernel
   releases its lock, allowing the next owner to recover it.

The lock file is **never deleted**, including after clean exit: unlinking it permits
independent locks on old/new inodes. Its descriptor is close-on-exec, so launched Pi
children cannot inherit singleton ownership. Opens reject symlinks; newly created
lock/socket permissions are 0600. Failure to acquire/open/bind/forward fails closed
with a stderr error, not duplicate startup. No process scan or upstream patch.

## Endpoint and IO compatibility

For `dev.nimrod.desktop`, paths are `/tmp/dev_nimrod_desktop_si.lock` and
`/tmp/dev_nimrod_desktop_si.sock`. The socket retains the old plugin's identifier
normalization and short `/tmp` location (macOS's per-user temp path can exceed Unix
socket limits). It is not session storage and does not live in preferences/state.

Wire format remains UTF-8 `cwd + NUL NUL + argv.join(NUL)` terminated by EOF. This
supports forwarding to an older CLI-capable build, without changing launch flags or
routing. Quit old builds before acceptance: they do not gain the new ownership
policy and an older already-duplicated population cannot be repaired by this code.
Pre-CLI builds do not participate; native platform behavior remains separate.

Requests are capped at 1 MiB. Connected send/read operations have a total two-second
IO deadline using nonblocking sockets plus `poll`, not per-read timeout resets.
On the tested macOS system Unix sockets reject `SO_RCVTIMEO` with `EINVAL`; `poll`
also prevents a trickling sender from blocking the ordered reader indefinitely.
A connected write failure is ambiguous acceptance: **no retry, no duplicate UI**.
Successful socket writes are not window-focus acknowledgements. Malformed/oversized
incoming requests are logged and discarded without mutating project/session state.
The reader sleeps in readiness polling, not repeated native/UI queries; its 500ms
cancellation check does not delay incoming launches, which wake the poll immediately.
Shutdown does not connect to a possibly full backlog or join the worker on the UI
thread.

Linux/Windows retain Tauri's existing single-instance integration. Do not generalize
this macOS-specific fix into an unverified cross-platform IPC protocol.

## Tests and remaining acceptance

`single_instance::tests` uses generated lock/socket paths in disposable directories.
The subprocess fixtures execute the Rust **test binary**, never Nimrod/Tauri UI,
Pi, user sessions/preferences, or the live app endpoint.

Coverage includes synchronous publication; one owner plus seven forwarded requests
from eight overlapping processes; secondary non-cleanup; legacy wire compatibility;
lock-holder-without-listener timeout without unlinking; stale-socket recovery; killed
fixture-owner recovery; idempotent explicit Exit cleanup with retained ownership;
connected write failure without retry/fallback; deadlines and malformed/oversized IO.

Run `mise run check` and `mise run build` in the task worktree. Native Launch Services
forwarding, actual project-window focus/cycling, pop-out visibility and Linux/Windows
acceptance are **not** established by these fixtures. No UI/scrolling code changed;
offline browser tests are not the native startup oracle.

Manual acceptance (user only): quit the old build, select the separately built app
with `NIMROD_APP`, issue two rapid launcher commands from a cold start for distinct
projects, and check Command–backtick/Window-menu membership. Repeat warm launches, reopen an
already-open directory, quit/relaunch, and verify normal pop-out project visibility.
See [verification](../../../../docs/verification.md) for executed results/artifact.
