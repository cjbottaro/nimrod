# Projects and sessions: implementation reference

Read the [human guide](../../../../docs/workspace-sessions.md),
[architecture](../../../../docs/architecture.md), and
[UI vocabulary](../../nimrod-ui-vocabulary/SKILL.md). Paths below are repository-root relative.

## Code map

| File | Responsibility |
| --- | --- |
| `index.html` | Project bar: sidebar toggle, identity, mode, icon-only Restart session, Settings |
| `src/main.ts` | Mounted sessions, lifecycle transitions, first-save identity, per-token native IPC, palette commands, drafts |
| `src/command-palette.ts` | Cmd/Ctrl+Shift+P, modal navigation, asynchronous pickers, name step and focus restoration |
| `src/pi/session.ts` | Pi startup/history/identity, authoritative RPC semantics and disconnect handling |
| `src/pi/transport.ts` | Ordered response callbacks, uncertain acknowledgements, disconnected transport invalidation |
| `src/pi/webview-client.ts` | Mounted renderer; explicit sessionReset; pending-submission settlement on disconnect |
| `src/pi/session-drafts.ts` | Shared project-local library, per-session selection, provisional promotion and recovery |
| `src-tauri/src/native_menu.rs` | Native File → Open project; preserve editing/window menus and app-owned macOS Quit |
| `src-tauri/src/main.rs` | Native menu dispatch, launch validation, close/quit serialization |
| `src-tauri/src/cli.rs` | Startup-gated ordered directory requests; menu/CLI reuse the same queue |
| `src-tauri/src/single_instance.rs` | macOS pre-runtime election, synchronous listener binding and owner-only cleanup; see [startup reference](single-instance.md) |
| `src-tauri/src/workspace_windows.rs` | Canonical cwd → native window routing, exact-file inspection and catalog IPC |
| `src-tauri/src/workspaces.rs` | Window/token-scoped children and canonical session-file reservations |
| `src-tauri/src/process.rs` | Child IO, framing, observed exit, escalation |
| `src-tauri/src/sessions.rs` | Read-only exact-file/cwd validation and Pi launch arguments |
| `src-tauri/src/session_catalog.rs` | Read-only Pi-specific session discovery |

## Product and navigation invariants

- Project identity is one canonical directory per window. Every session in that window has the exact same cwd; nested directories/worktrees are not automatically grouped.
- User-facing terminology is Project/Project bar. Existing `workspace` identifiers, IPC commands, `workspace-*` native labels, `--workspace` internal flag and compatibility storage keys remain unchanged.
- No Open project or command-palette buttons in the Project bar. Open project is a native File-menu action with Cmd/Ctrl+O; palette entry is keyboard-only Cmd/Ctrl+Shift+P. The welcome directory chooser remains. No generic Disconnect action.
- Native File-menu navigation uses the folder picker and enqueues `Request::Workspace`. It works with a pop-out focused or without a project frontend. Router source is absent: focus an existing project or create a project window, never rebind a mounted welcome screen. Project boot records its path in recents.
- Install a File submenu if Tauri's default lacks one (Linux). Preserve other native actions. macOS Quit MUST remain app-owned: predefined Quit invokes AppKit terminate directly and bypasses cancellable Tauri exit handling.
- Sidebar All / Unread / Working views filter the same open sessions without lifecycle effects; Switch session still reaches all open entries, switching to All for a filtered-out target. `active` is remembered navigation; `presented` owns the shown conversation/actions, and may be absent in attention. Automatic Close replacement must not switch to All or expose a hidden target. Successful tree deletion uses the separate batched next/previous rule and explicitly falls back to All if attention has no remaining candidates. See [sidebar attention](sidebar-attention.md) for ordering, retention, counts, view persistence and keyboard behavior.
- **Open/closed** is sidebar membership, **connected/disconnected** is the live transport/process connection, and **working/idle** is agent activity. These are independent dimensions, not synonyms. All entries retained in the sidebar are open, including inactive restored entries, disconnected entries and temporary/demo sessions. Hiding the sidebar or filtering rows does not alter membership. A disconnect alone must not remove an entry; closed entries must not retain owned processes. Switching entries does not stop children. Restored entries stay inactive until selected. Closing waits for observed stop before removing the entry; a failed stop leaves it visible.
- **Switch session** enumerates open sidebar entries without a connection-state requirement, even when Unread or Working filters them out. **Resume session** enumerates saved top-level project history, including already-open and closed sessions; temporary/demo entries belong to Switch, not saved history. Do not use native process ownership or transport connectivity as the source of the open-session list.

## Session management

### Switch row presentation

- Switch items carry `PaletteItem.sessionRow` with `tab.lastUsed` and the same shell `indicator(tab)` result used by the sidebar. `src/session-sidebar.ts` owns shared DOM creation, incremental updates, time formatting and accessible status labels; both surfaces use the same row/indicator CSS.
- Visible content is an indicator, title and muted relative time/date only. Status and Current remain searchable, not visible text or hover tooltips. Resume previews/Open badges and other palette pages retain their existing renderer.
- `test/command-palette.test.ts` covers every indicator state, timestamp semantics, accessible labels and status search; `test/shell.test.ts` compares Switch/sidebar content for connected/inactive entries hidden by a filter, preserving membership and process reuse.

### Resume picker

- `session_catalog.rs` returns optional `parentSession` metadata from Pi's header; `sessions.rs` carries the same metadata through exact-file inspection/startup. Missing/null parent means root; a nonempty string means child. Malformed parent metadata is reported, not treated as a root.
- `paletteSessions` filters children after overlaying open-session titles. Pi's subagent extension uses `parentSession`, as do saved forks/branches: the picker intentionally lists roots, not all user-created branches. Do not infer child status from names, prompts, filenames, notifications or agent tool calls in a parent's history. Children written without parent metadata cannot be reliably distinguished.
- Open exact-file entries outside the catalog are inspected read-only before inclusion, so an open child cannot leak back into Resume through sidebar merging. Failed inspection retains the sidebar entry/draft and contributes a picker warning; it does not launch Pi. Such entries have no catalog mtime, so show **Saved session** and sort after timestamped history rather than inventing a resume-time timestamp.
- `PaletteItem.badge` renders separate plain text alongside the truncatable title; the preview remains on its own line. **Open** uses sidebar path membership only, not `presented`, transport, child ownership or the current sidebar filter. Closed entries have no badge. Badge text participates in search and the option's accessible text.
- Choosing an open entry goes through the existing `openSession`/activation path: reuse its mounted entry and connected process, or explicitly resume an inactive entry. Switch remains all open entries (including child, temporary and demo sessions); exact-file resume remains permitted for children. No duplicate entry/process or prompt replay.
- Fixture coverage: `test/command-palette.test.ts` checks badge structure/search/activation; `test/shell.test.ts` checks connected/inactive/disconnected membership, filtered rows, Close, root/child filtering, out-of-catalog open children and unchanged Switch/reuse behavior. Rust catalog fixtures cover absent/null/valid/malformed lineage and child exact-file inspection. Native badge layout/picker acceptance remains user validation, not a jsdom guarantee.

### Reload (Restart session) lifecycle

The user-facing action is **Restart session**; “reload” refers to its Project bar icon, not Pi's `/reload` command or a webview reload. See the [user guide](../../../../docs/workspace-sessions.md#reload-restart-session).

`restartable(tab)` requires a verified `file.exists`, non-temporary mode and non-demo session. `restartControl()` also disables the icon before boot or while starting, closing or restarting. Keep it visible when disabled and supply reason-specific tooltips. Newly reported file paths are not persistence: native `session_file_info` must confirm identity/cwd and existence before enabling.

`restartSession(tab)`:

1. Revalidate session presence, saved identity, settings modality and lifecycle guards. Capture the target session, not an active-session pointer across awaits.
2. Set `restarting` before any confirmation/stop await. This disables duplicate restarts/Close, marks the row Restarting, blocks automatic launch on reselection, and locks session input. Stop confirmation is needed for busy/compacting state, submission state, extension input, or pending queue work. Cancel is a no-op except clearing the guard.
3. Call `stopOwned` for its exact token. This is native IPC, NOT an RPC abort/get_state request, so a stuck RPC does not prevent termination. Do not start a replacement until native stop resolves. Preserve file reservations on native failure.
4. Cancel preference/extension dialogs, settle pending submissions through `sessionDisconnected`, disconnect the old transport and mark it ended. Suppress generic disconnected notices while restarting.
5. Reuse `launch` with exact saved file/ID, runtime's next-launch preferences and a new token. Native launch revalidates disk identity/cwd; Pi's identity must match before submission is enabled. No fresh-session fallback.
6. Preserve mounted session ID, sidebar row, renderer root and draft identity. Reuse the normal explicit sessionReset/history path: disclosure state resets; this is not a webview reload. Pop-out ownership remains attached to the same mounted session and saved identity. Do not retire/close the source session.
7. Clear the restart guard in finally. The pane stays inert through restart startup, so the ordinary launch focus is deferred until the restart lock is cleared; focus the composer only if that session is still selected, startup succeeded and no dialog is open. Errors retain the entry/draft, with explicit retry. A stopped child with invalid history remains inactive; no automatic resend.

`stopOwned` coalesces concurrent cleanup requests for a token. Clear only the matching cached promise on rejection so another explicit attempt can actually retry stop. Keep successful stops cached until `launch` allocates a new token, preventing delayed old cleanup from stopping the new child.

No automatic prompt or queue replay. Renderer `sessionDisconnected` turns pending submissions into unknown; only actual Pi acknowledgement may clear an unchanged submitted draft. Newer drafts remain. Token/generation guards reject old channel events, late receipts, identity callbacks and startup failures after another launch. Sibling transport/drafts/processes remain independent.

Do not call `clear_queue` before restart: that would require a responsive Pi and defeat the escape hatch. Existing locally retained recovery text survives; remote in-flight/queue state is not a process-continuity guarantee.

### Delete session trees

The Project bar's trash icon, per-row sidebar trash and palette action use Nimrod's Rust-native session-file preview/removal with confirmation scoped to the initiating window. App-wide locks coordinate affected session writers, and persisted quarantine prevents implicit resume after partial/unknown outcomes. This changes neither Close nor Restart semantics; see the [session deletion reference](session-deletion.md) for code, protocol, lifecycle and fixtures.

## Ownership, discovery and persistence

- `WorkspaceHost` owns one `ProcessHost` per token scoped to the native calling window. Frontends cannot stop another window's child. Canonical session-file reservations prevent duplicate Nimrod writers, not external writers or hard-link aliases.
- Native start/stop serialize registry/child slot access. Stop waits for child exit; Unix escalates SIGTERM to SIGKILL after 1.5 seconds, Windows uses native termination. Target only owned children; no OS-wide process scans or daemon claims.
- Resume uses canonical absolute `--session` paths, never `-c`, partial IDs or most-recent lookup. Inspect rejects missing/empty/malformed/unsupported files and wrong cwd; 256 MiB per file, 16 MiB per JSONL record. Pi interprets/migrates history.
- `session_catalog.rs` reads Pi's encoded cwd directory, or `PI_CODING_AGENT_SESSION_DIR`; `PI_CODING_AGENT_DIR` also applies. Expand tilde/relative paths consistently with child environment. Listing must not create files/directories, load extensions, launch Pi or send prompts. Pi's `SessionManager.list` creates directories during discovery, so do not substitute it for Nimrod's read-only reader.
- Custom unrelated paths and differently encoded symlink aliases are not recursively searched; exact-file open remains available. Names come from `session_info`, previews from first user message; unreadable files are reported, not repaired.
- Project draft library: browser storage `nimrod.sessions.v1:<canonical cwd>`. Each session forks shared backing metadata with its own selected draft key. Persistent drafts use `file:<canonical path>`; new persistent sessions use `unassigned:<mounted UUID>` until verified promotion. Temporary/demo drafts use their project/mounted UUID namespace only in memory. `SessionDrafts.flush` excludes both prefixes even during sibling saved-session writes; `recoverable` excludes them. Loading ignores older persisted entries, and the next library flush removes those old entries from the serialized library.
- App-managed `state.json` retains `nimrod.tabs.v1:<cwd>` for open order/selection and per-entry `lastUsed` timestamps (All displays recency order; ties retain open order), `nimrod.recency.v1:<cwd>` for canonical-path/session-ID-bound recency across Close (creation/accepted message time, historical user-message seed for unknown sessions), `nimrod.workspaces.v1` for recent paths, `nimrod.sidebar.visible`, `nimrod.sidebar.width:<cwd>` for independently saved sidebar size, `nimrod.last-session.v1` and legacy launch state. Naming cleanup needs no schema migration. Already-mounted layouts are not rebuilt from external state changes. Runtime/theme/zoom synchronize separately through Preferences.
- Closing a saved session is not deletion. Unwritten persistent-session drafts remain explicitly recoverable; recovery copies rather than consuming them. Temporary/demo sessions are disposable: confirmation states that drafts, queued messages and pop-outs are discarded. `Dialogs.confirm` handles Enter as confirmation and Esc as cancellation regardless of button focus, suppressing composing/keyCode-229/repeated Enter. Its per-request keyboard listener is removed on close; input/select dialogs keep their existing behavior. Wait for owned shutdown before detaching; Cancel or failed stop retains the live session/draft. `detachTab` disposes the view and calls `discardTemporary`, which deletes runtime memory and blocks late writes from resurrecting it. No temporary state survives window close, quit or reload. Existing native pop-out synchronization releases temporary runtime windows without writing saved references. `persistTabs` explicitly excludes temporary/demo owners. Browser storage errors are visible and are not a durable-draft guarantee.

## Rendering, focus and related features

- Each mounted session owns its controller, transport, renderer and draft selection. Preserve DOM when switching; suspend hidden geometry observations and restore reader intent when selecting.
- Modal palettes/dialogs own focus during background streaming. Escape cancels/closes the entire command interaction and restores prior focus; explicit Back returns to commands with the prior query. The [command-interaction reference](command-interactions.md) owns the shared lifecycle contract. Lifecycle actions run after native HTML dialog close. Guard IME/repeated Enter.
- Restart uses an explicit launch boundary, so do not infer ordinary snapshot preservation of disclosures. No document/window reload and no geometry reset for other sessions.
- Pop-out sync is at selection, identity promotion, close and boot boundaries. Restart keeps runtime owner identity; see [pop-outs](pop-outs.md) before changing source-session retirement/focus behavior.
- Native menu, folder chooser, AppKit focus, menu shortcuts and Windows/Linux behavior require native acceptance. Source guards/jsdom/offline WebKit are not proof of native execution.

## Tests and verification

- `test/shell.test.ts`: absent chrome buttons; keyboard-only palette; disabled temp/demo/first-save restart; first-save promotion; exact-file restart and stable mounted session/draft; sibling isolation; cancellation; serialized stop; unknown acceptance and late old receipts; reselection/background restart without sibling focus theft; disconnected restart; failed-stop retry; resume failure with no fallback.
- Existing shell tests retain background dialogs, per-token close, independent drafts, restored history without prompt replay and pop-out ownership/focus checks. Former Disconnect-action tests now Close temporary sessions. Temporary/demo Close tests cover confirmation wording, cancellation, failed-stop retention, successful discard, pop-out owner retirement, saved sibling isolation and absence of temporary text from browser storage. `test/session-drafts.test.ts` covers memory-only runtime state, sibling serialization, old-entry cleanup and late-write suppression.
- `test/dialogs.test.ts`: confirmation Enter/Esc from Cancel focus, composing/repeated Enter suppression and keyboard-listener cleanup before extension input. Offline WebKit `workspace-tabs.spec.ts` verifies temporary Close cancellation/confirmation with retained draft, exact owned stop and no prompt replay.
- `test/command-palette.test.ts`: keyboard/modal/IME/retry/focus behavior; focus fixture uses a remaining Project bar control, not the removed palette button.
- `test/browser/workspace-tabs.spec.ts`: removed controls, visible disabled demo Restart icon, independent live sessions and shortcut/focus behavior using offline children.
- Rust `native_menu.rs`: action identity isolation; existing `cli`, `workspace_windows`, `workspaces`, `sessions`, `process` fixtures cover routing/ownership/exit/exact-file invariants. Tests do not invoke real native menus or real user Pi sessions.
- `scripts/check-themes.mjs`: remaining restart icon in the theme/layout fixture instead of removed Disconnect.

Run `mise run check` and `mise run build`; run offline `npm run test:browser` for affected layout/focus regressions. No user app/window launch or interruption, model requests, user-session mutation or upstream changes. Record results in [verification](../../../../docs/verification.md), with native menu/picker/restart acceptance explicitly remaining.

Latest combined-checkout evidence: 238 TypeScript/Node tests, 47 default Rust tests (two opt-in real-Pi smokes ignored), formatting/Clippy, packaged macOS build and 14 offline WebKit tests passed. An earlier WebKit rerun caught a mixed intermediate notification edit (`preferences.notificationsEnabled` missing); after those concurrent edits landed, the complete rerun passed. No notification implementation changes were made for restart. Native saved-session restart/menu/focus acceptance remains unperformed.
