# Nimrod: architecture and behavior

## Product identity

Nimrod is a dedicated app for directory-backed coding projects and their agent sessions, not an IDE or a generic chat frontend. A project is one canonical directory per window, with no Git, manifest or registration requirement; it is also the working directory of every session in that window. Sessions should not compete with files/diffs/searches for editor tabs. File and eventual diff handoff connects the project to the user's editor.

Use **Project** and **Project bar** in the UI. Existing `workspace` identifiers, IPC commands, native window labels, internal CLI flag and storage keys remain compatibility details. Nested worktree directories do not change the exact-cwd session boundary; grouping worktree-rooted sessions under a parent project is not implemented.

The broader direction is **bespoke UI for multiple harnesses**. This explicitly differs from the original Pi GUI's Pi-only product boundary. Share shell infrastructure and useful rendering primitives when justified; retain harness-specific semantics and controls. Do not design a universal harness protocol from one integration. Pi is the only PoC harness.

## Current division of responsibility

```text
Tauri window
  src/main.ts              project/sidebar, per-session lifecycle + native bridge
  src/command-palette.ts   modal command navigation + asynchronous session picker
  src/popout.ts            read-only code snapshot window, clipboard + appearance
  src/session-popouts.ts   coalesced session visibility/identity + pop-out dispatch
  src/settings.ts          settings navigation and saved runtime preferences
  src/preferences.ts       JSONC edits, migration, revision-ordered file synchronization
  src/dialogs.ts           queued, modal input/select/confirm surfaces
  src/themes/              app color themes, local imports and persistence
  src/pi/webview-client.ts existing incremental transcript/composer renderer
  src/pi/session.ts        Pi lifecycle and presentation coordination
  src/pi/session-drafts.ts scoped local composer state + exact last-session pointer
  src/pi/transport.ts      Pi request correlation and acknowledgement deadlines
             ↕ typed Tauri commands / ordered Channel<Packet>
Rust
  src-tauri/src/main.rs    launch validation, runtime discovery, resources, quit
  src-tauri/src/popouts.rs session-scoped native snapshot windows and lifecycle
  src-tauri/src/popout_store.rs atomic per-pop-out files + app-state references
  src-tauri/src/popout_windows.rs automatic visibility without macOS key-window activation
  src-tauri/src/preferences.rs XDG files, atomic persistence, polling + broadcasts
  src-tauri/src/window_state.rs project-scoped native window geometry
  src-tauri/src/native_menu.rs app-owned macOS Quit, retaining other native menus
  src-tauri/src/cli.rs     argument validation + ordered forwarded project requests
  src-tauri/src/workspace_windows.rs canonical directory/window routing
  src-tauri/src/session_catalog.rs read-only Pi session discovery
  src-tauri/src/workspaces.rs window/token ownership, canonical-file reservations
  src-tauri/src/process.rs one owned child per instance; framing, pipes, shutdown
  src-tauri/src/sessions.rs read-only Pi file/cwd validation and launch arguments
  src-tauri/src/links.rs   validated file/HTTP handoff
             ↕ LF-delimited JSON RPC
Installed Pi (or explicitly selected offline fixture)
```

There is no additional Node helper backend. Pi and the optional demo fixture require Node. The existing reducer and UI controllers remain TypeScript because they model presentation, not byte transport or process ownership. Request correlation also currently lives in TypeScript so response snapshots can be applied synchronously before the next event in the ordered channel. This is a bounded port, not a claim that every host concern is already Rust.

Rust's `LaunchConfig` and `Packet` have corresponding small TypeScript shapes. They are hand-maintained in the PoC, not generated bindings. Pi's open-ended event payload stays JSON; Rust validates the outer record/type and the existing reducer validates relevant content. A future second harness does not automatically inherit Pi's event model.

## Terminal entry point

`bin/nimrod` is a Bash launcher for macOS/Linux. It canonicalizes the requested directory relative to the terminal cwd and starts the existing app with `--workspace <absolute path>`. On macOS it uses Launch Services (`open -n -a`); Tauri's single-instance plugin forwards a transient second launch's arguments/cwd to the primary app and exits before creating its UI. No separate CLI binary, Node backend, or harness protocol is involved. The plugin uses the app identifier for its instance endpoint; pre-CLI builds do not participate.

Configured windows have automatic creation disabled. Setup explicitly creates exactly one initial window: a registered project window for a cold CLI launch, or the `main` welcome window for a normal app launch. The project directory is registered before its frontend mounts and reads `window_workspace`. The welcome screen starts hidden in HTML and is revealed only after initialization confirms no project. Project windows show their restored conversation or a separate empty-project view, including after the last session closes; they never show the welcome screen. Forwarded requests wait until setup is complete and are handled in received order on a worker. Both CLI and GUI calls use `route_workspace`: canonical-directory matches are shown, unminimized and focused, otherwise a window is created. A forwarded request does not rebind an already-mounted welcome window. Registry-reading IPC is asynchronous so it cannot block the UI thread while a route is creating/focusing a native window.

CLI navigation never invokes `start_pi`, sends prompts, or resumes sessions. The Bash wrapper validates paths/build availability and reports launch failures, but OS launch success is not an application-level focus acknowledgement. Post-forwarding routing errors are shown in the app. Native focus/forwarding acceptance and simultaneous cold-start behavior are not established by fixture tests.

## Ownership and recovery

- `WorkspaceHost` owns one `ProcessHost` per session token, scoped to the native calling window. Commands cannot address another window's children. Active sessions in one window must share a canonical cwd; duplicate tokens and canonical session-file reservations are rejected across windows. Pi-reported files are reserved before first save. This does not exclude external writers or hard-link aliases.
- One canonical directory per window, independently live sessions, and a collapsible session sidebar. The sidebar is a flat open-session list with no repeated project directory, disclosure, history/search field, or secondary action buttons. Cmd/Ctrl+Shift+P opens commands; Resume session drills into a project-scoped type-to-filter history picker, while Switch session lists only currently open sessions shown in the sidebar. Cmd/Ctrl+Shift+[ / ] cycles those open sessions. Each session owns its controller, transport, renderer and draft selection. Opening another directory creates/focuses its window without launching Pi; see [workspace-sessions.md](workspace-sessions.md).
- Native start/stop serialize access to the registry and individual child slots. Window-scoped stop without a token stops only that window's children; application quit stops all. Failed shutdown retains the file reservation rather than allowing a replacement writer. Registry lifecycle operations currently serialize globally; writes and event delivery remain independent.
- Within each child, native start/stop serialize access to the slot. Stop waits for observed child exit before allowing another launch. Session-triggered asynchronous cleanup carries its token, so a delayed old cleanup cannot stop a newer child; reload stops the window's owned children; application quit stops all owned children.
- Unix shutdown closes stdin and sends SIGTERM, escalating to SIGKILL after 1.5 seconds. Windows uses native termination. Reap the child; `kill_on_drop` is the final in-process fallback.
- Only the owned child is targeted. Detached children are not guaranteed to be cleaned up. Abrupt OS-level death of Nimrod is not a daemon/recovery solution.
- Window close rejects late starts, reaps its children, then destroys that window. Other project windows remain open. Application quit reaps all owned children; no background process continuity.
- Frontend reload stops any old owned process before enabling explicit launch/resume. It never automatically reconnects or replays. Temporary history is lost; history already persisted by Pi remains resumable.
- Keep unsent/pending composer state in app-local webview storage, scoped by canonical Pi session file. New saved sessions use provisional keys until their file is written; temporary/demo drafts have separate per-tab keys. Tab selections share a project-local library; different project windows use different storage keys. Pending submissions become unknown on disconnect or restore. A user must explicitly permit another send; no silent resend or acknowledgement inferred from disk history.
- Legacy PoC and unassigned provisional drafts remain available through explicit recovery into a new saved session; their source is retained. No global draft is silently assigned to a resumed conversation. Storage errors are surfaced without pretending local storage is durable.
- A renderer generation guard prevents late old-session callbacks from replacing a new session's presentation.

## Persistent Pi sessions

- The sidebar lists open sessions with activity and close controls; history is loaded on demand in the command palette, not duplicated in the sidebar. New session is persistent by default; temporary/demo sessions are explicit. Selecting history opens/resumes a session; selecting an already-open inactive persistent session automatically resumes it. Reopening a project restores remembered persistent sessions without startup; selecting one starts Pi and loads history, but never submits a prompt. The existing internal tab/session storage identities are retained to avoid losing saved open-session state. Each live session has an independently owned child.
- The palette uses native dialog modality over mounted conversation views. Loading/error/empty states are explicit; late discovery results cannot overwrite a newer picker, commands, or a closed dialog. Escape in the picker returns to the previous command query; Escape from commands closes. Actions run after the native close event restores focus. IME/repeated Enter cannot accidentally activate an action; higher-priority Pi dialogs retain modality.
- Saved launch omits `--no-session`; Pi chooses its file and owns all conversation writes. New named session collects a non-empty, single-line name in a compact command-palette step before creating a session or starting Pi. The existing palette input becomes a textbox (without listbox/combobox semantics); navigation results and Back/Refresh are hidden, with an inline Create button and Enter/Esc hint. Empty names disable Create. Enter/Create use the normal post-close action boundary; Esc cancels directly, restoring prior focus. IME/repeated Enter cannot create a session accidentally. Pi's extension dialogs retain their multiline input. The native launcher passes it as a literal `--name` argument (new persistent sessions only); the normal startup state confirms Pi's name before enabling submission. This requires a Pi runtime supporting `--name`. Failure remains a startup error, with no rename-RPC fallback, prompt or automatic retry. Naming alone does not establish persistence. Temporary/demo launch remains explicit. Launch mode is independent of initially absent file metadata.
- Resume passes a validated canonical absolute `--session` path, never `-c`, a partial ID, or an interactive picker. Rust rejects missing/empty files, malformed JSONL, invalid/unsupported headers (versions 1–3), or a canonical header cwd different from the selected project. Limits: 256 MiB/file, 16 MiB/record. Pi still interprets/migrates valid session contents; Nimrod does not rebuild its tree.
- Native launch returns the selected file/ID and canonical cwd. Before enabling submission, Pi's `get_state` identity must match that selected file/ID. A remembered last-session ID is also checked before launch to detect a replaced file. Failure never falls back to a new session.
- A new file path is not proof of persistence: Pi 0.86.1 delays flushing until an assistant message exists. The badge remains **awaiting first save**, with provisional drafts, until native inspection confirms a file matching Pi's ID/cwd. Then Nimrod binds its draft to the canonical path and remembers only that path/ID/project for explicit resume. The existing coalesced metadata refresh also runs after saved-session message completion to discover the first write without polling.
- History loads through the existing synchronous `get_messages` response callback, preserving wire order with later events. This is Pi's active context, not all branches/pre-compaction entries. Resume restores no process or queued work. Only an explicit launch boundary resets session-local composer/disclosure state; routine snapshots retain live presentation.
- The native registry prevents duplicate canonical session-file ownership inside this Nimrod process, not concurrent external writers. Other Pi/Nimrod/VS Code users of the file must stop before resume; no OS-wide scans or file-lock guarantee. File validation is not atomic against external mutation.

## RPC ordering and failure

- Rust uses bounded LF-only UTF-8 framing (16 MiB maximum stdout record), accepting CRLF and a final unterminated record. U+2028/U+2029 remain ordinary string data.
- Every stdout record, including command responses, travels over one ordered Tauri channel. Do not split responses and events into separately scheduled transports.
- History/state response callbacks run synchronously during channel delivery. Promise continuations alone are insufficient: later streaming events can otherwise be overwritten by an older history snapshot.
- Ordinary RPC acknowledgement timeout: 20 seconds. Unknown acceptance is distinct from Pi's explicit rejection. Nothing is automatically retried.
- `abort` can wait indefinitely for Pi's RPC acknowledgement; Disconnect remains available to terminate the child.
- Pipe/JSON/channel failure stops the owned child and invalidates pending requests. The UI remains draft-editable but unavailable for submission.
- Native IPC only permits this PoC's named Pi operations. There is no exposed arbitrary shell-command API. Transcript links never navigate the app webview.

## Application settings

- Rust owns user-editable JSONC configuration (`~/.config/nimrod/settings.json`) separately from app-managed bookkeeping (`~/.local/state/nimrod/state.json`). Absolute XDG root overrides apply on all platforms; Windows also uses a home-directory layout. The host polls at 500 ms and broadcasts revision-ordered snapshots to open windows. UI saves preserve comments/unknown keys, serialize writes, atomically replace files, and reject detected source-text conflicts. External writers remain unlocked. Legacy preference/layout keys migrate once; drafts/uncertain submissions retain their separate browser-storage boundaries. Project settings are deferred. See [settings.md](settings.md).
- Window size/physical placement/maximized state is saved per canonical project on orderly close/quit, with bounds and missing-display fallback on restore. macOS Quit/⌘Q is an app-owned menu action routed through geometry save and observed child shutdown; the predefined AppKit Quit action bypasses Tauri's cancellable exit request. A final-exit fallback flushes cached geometry synchronously without querying terminating windows. It is not a user preference or a guarantee against abrupt termination; native multi-display/DPI behavior requires acceptance.
- Application preferences live on a separate **Settings page**, opened by the project-bar gear or ⌘/Ctrl comma and dismissed with Back/Escape. Theme/import/removal and zoom live under Appearance; Pi/Node executable paths live under Runtime. This supersedes preferences in the project bar and runtime fields in the launch form.
- The page is a full-viewport native HTML dialog. Browser modality isolates focus/accessibility while the underlying project stays mounted with unchanged layout geometry. Live rendering continues; no process teardown, transcript replacement, or scroll reset. Existing Pi dialogs retain priority, including dialogs opened while Settings is visible.
- Startup completion must not focus the composer through Settings or another dialog. Native close restores prior focus; only an empty-body fallback targets the gear when a startup transition hid the original control.
- Theme and zoom preferences remain immediate/persistent. Runtime edits require **Save runtime paths** and affect only a future launch's snapshot, never the current child. Unsaved edits survive page navigation but aren't committed. Save/validation failures retain the prior saved paths; legacy launch preferences are migration sources. External edits update the next-launch snapshot, preserving dirty Runtime fields with an explicit notice.
- Project selection is on the launch screen and project bar; model and thinking stay in each session's status area. See [settings.md](settings.md).

## Pi-specific behavior

- Always send `streamingBehavior: steer`, including when the latest snapshot said idle.
- Retain submitted text until acknowledgement; clear only the unchanged draft. Preserve rejected/uncertain originals alongside newer text.
- `agent_end` is not idle; `agent_settled` is the normal idle boundary.
- Stop requests authoritative `clear_queue`, exposes its exact returned text for recovery, then sends `abort`. During compaction, abort without clearing the queue.
- Manual `/compact` is a Nimrod-owned control operation: it requires an idle session, optionally accepts custom instructions, locks the composer while Pi compacts, and refreshes context once safely idle. Slash-command session management remains explicitly deferred; exact-file resume is a palette/sidebar or launch-screen operation. Automatic compaction uses the same composer lock and refresh behavior.
- Model and thinking-level choices use command-palette pages (including status-button entry points), with current-value markers, filtering, cancellation, loading and visible errors. Each request remains bound to its originating session. Back/close cancels pending selection; stale metadata cannot replace another page. Retrying waits for the prior controller operation to settle. Pi idle state and supported levels are revalidated before mutation; only Pi acknowledgements refresh displayed selections. A missing startup model/level list is reported in the picker rather than permanently disabling effort selection. Fresh unwritten sessions can select their first model without submitting a prompt. Extension-provided select dialogs retain their existing separate behavior.
- Models/levels come from Pi. The bundled read-only scope extension reports `ctx.scopedModels`; do not recreate settings/glob matching. Unavailable scope metadata must not silently expose all models.
- Extension UI is only as capable as Pi RPC: status/widget text and basic dialogs work, TUI component factories do not. Rich subagent details are not inferred from status counts.
- Unsupported GUI commands are removed from suggestions and rejected locally. Other discovered commands keep Pi's own dispatch semantics.

## Rendering contract retained from Pi GUI

- Tool generation, execution output, final result, and result processing are separate states.
- Cards start closed. Only sustained non-empty execution updates can auto-open a running tool after 500ms; final results do not qualify. Manual choices win and auto-open has a minimum dwell.
- Preserve connected spinner/disclosure nodes through incremental updates.
- Transcript gets its own scroll pane above the in-flow composer. Preserve reader intent through streaming and resizing; do not pull readers out of older history. A ≤2 CSS-pixel offset adjustment when both recorded positions are at the bottom is native rounding, not upward navigation. It must not cancel pending follow or latch auto-follow off. Explicit upward wheel/touch/key input and meaningful upward scrollbar movement remain authoritative.
- Transcript, status content, submission notices, and composer fill their available width with a fixed 20 CSS-pixel gutter on each side (scaled normally by app zoom). They grow and shrink with the window; no fixed reading-width cap or widening center margins. This supersedes the inherited 920/960px caps and the initial status-area centering calculation. The status background and both separator lines remain full-width. Launch forms and modal dialogs retain their independent compact sizing.
- Whole-app content uses native webview page zoom, not font-size changes or CSS transforms. Default 125%; restore the saved percentage (75–200%) at startup. The Settings → Appearance picker and ⌘/Ctrl +/− adjust it; ⌘/Ctrl 0 resets to standard 100%. Native zoom requests are serialized and only successful changes are persisted. Zoom does not refocus controls or alter drafts; the existing resize/follow scheduler handles viewport changes.
- No routine snapshot steals focus. Launching explicitly focuses the composer once, only if its tab is still selected. Modal dialogs own focus while open. Hidden tabs suspend scroll geometry bookkeeping while retaining follow intent or the reader's offset; selecting a tab restores its mounted DOM rather than recreating it. Renderer template IDs are unique per tab, with stable `data-pi-id` hooks for scoped lookup and styling.
- Safe Markdown, code copying, raw tool inputs, and eight-line live/sixteen-line final output caps remain.
- [Pop-outs](pop-outs.md) are Nimrod-owned, immutable reference windows scoped to the selected session. Identical content/language within a session shares a window, independently of transcript position or compaction. Saved snapshots/geometry survive restart; source-session Close preserves them, explicit pop-out Close removes them. Automatic macOS restoration preserves composer/dialog focus; explicit Pop out focuses the reference. Pi remains authoritative for session identity and files. See the [pop-out implementation reference](../.agents/skills/features/references/pop-outs.md) for storage, native lifecycle, focus pitfalls and tests.
- The **Nimrod scheme** is the app's custom theme, with dark and light variants, defined in `src/theme.css`: blue-gray foundations, mint/teal accents, and warm gold details. It is not a named third-party theme. Some syntax-highlighting fallbacks remain inherited from the original renderer. It remains the default and follows system appearance.
- The theme picker in Settings → Appearance also offers **Dracula** (a credited dark adaptation) and standalone VS Code JSON/JSONC color-theme imports. Theme changes are CSS-color-variable-only: preserve transcript node identity, disclosures, scroll, focus, drafts, zoom and harness state. Imported color schemes are explicitly light/dark regardless of OS appearance; returning to Nimrod clears all overrides.
- Theme import accepts only allowlisted hex colors and broad syntax foreground rules, never arbitrary CSS, fonts, scripts, includes, external token files or URLs. Imports/selection are stored locally and validated on restore. Invalid/canceled imports and persistence failures preserve the current selection. Remove affects only Nimrod's copy. See [themes.md](themes.md) for the format, mapping limits and storage bounds.
- `--vscode-*` CSS variable names are retained as internal compatibility tokens; `src/theme.css` supplies them. There is no runtime dependency on VS Code or its theme API.

## Platform boundaries

Tauri uses WebKit on macOS, WebView2 on Windows, and WebKitGTK on Linux. Exact browser behavior still needs platform testing. File handoff is currently VS Code-specific. The macOS launcher can find the bundled `code` CLI when it is not on PATH; Windows npm wrapper handling is deferred (select Pi's JS entry point explicitly).

No cross-platform parity, native acceptance, or process-tree cleanup guarantee should be inferred from a passing compiler or mocked DOM test.

## Source provenance

The transcript/reducer/composer modules and baseline tests were copied from the user's local `../pi-gui` working tree, including existing uncommitted interaction fixes, without changing that project. The VS Code extension host was not copied. Nimrod has its own renderer bridge, Pi coordinator, Rust backend, packaging and product policies. `scripts/bootstrap-ui.mjs` records the one-time extraction; do not rerun it as a build step or overwrite later Nimrod changes.
