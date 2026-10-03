# PoC verification

## Pop-outs

- Latest runtime verification: **224 TypeScript tests**, Rust formatting/Clippy,
  **45 default Rust tests** (two opt-in Pi tests ignored), and a packaged macOS build.
- **14 offline WebKit tests** passed for rendering/layout; they were not rerun for
  the later native-only focus fix. Snapshot filesystem tests use disposable directories.
- Remaining native checks: saved-session quit/relaunch, composer/dialog focus,
  switching, explicit-click focus, Close versus Quit, minimization and multi-display geometry.
  Windows/Linux behavior is not accepted from macOS builds or mocked IPC tests.
- No user app was launched/interrupted, model request made, or user-session/state file modified.

See the [feature guide](pop-outs.md) and [agent implementation reference](../.agents/skills/features/references/pop-outs.md).

## macOS Quit geometry persistence correction

- User-reported failure: resizing/moving a project window, quitting, and reopening with `nimrod .` did not restore its geometry. Read-only inspection found no window entries in the app-managed state file.
- The default macOS predefined Quit item invokes AppKit `terminate:`; Tao delivers the final Exit event rather than Tauri's cancellable ExitRequested event. Geometry saving had only been wired to close/exit-request handling.
- `native_menu.rs` replaces only that native Quit entry with a normal Nimrod-owned menu item using ⌘Q. Both the menu action and ordinary exit requests now use the existing geometry-save / observed-owned-child-shutdown path. Edit/Services/Hide/Window and other native actions remain unchanged. A final Exit fallback synchronously saves cached geometry without querying terminating windows; this fallback is not an observed-child-shutdown guarantee for OS-originated termination.
- Regression tests cover Quit-ID dispatch and final-exit cached geometry serialization under canonical project keys, including multiple projects and rejection of orphan-window attribution. `mise run check` passes: **205 TypeScript tests**, formatting/Clippy, **33 default Rust tests** (two opt-in real-Pi tests ignored). `mise run build` packages the updated macOS app.
- The user's state/configuration files were read only; no user app/window was launched or interrupted. No live Pi/model request or user-session change was made. No scrolling/frontend behavior changed; browser tests were not rerun for this native-only correction.

Native acceptance remains: quit the old build, launch the updated build with `nimrod .`, resize/move once, use ⌘Q / the Quit menu, then reopen the same canonical project. Check native size/position and saved `window:<project>` state. Dock Quit and maximized/multi-display restoration also need user verification. Earlier unsaved geometry cannot be recovered from a state file that contains no geometry.

## File-backed preferences and app-managed state

- Nimrod settings now live in home-directory/XDG-style JSONC configuration, with separate versioned app-managed state. Rust owns serialized/atomic persistence and 500 ms file polling; revision-ordered broadcasts synchronize Appearance and saved Runtime across windows. JSONC edits preserve comments and unrelated keys. Legacy preferences/layouts migrate without removing draft recovery sources; drafts and uncertain submissions retain their original browser-storage boundaries.
- Coverage includes normal/external file edits, invalid-file recovery, source-text conflicts, stale broadcasts, state-key merging, existing-config precedence, partial legacy runtime paths, dotfile symlinks, persistence failure, dirty Runtime fields, and next-launch-only runtime changes. The WebKit offline fixture verifies external theme/settings updates retain conversation DOM, draft, and transcript position.
- `mise run check` passes: **205 TypeScript/Node tests**, formatting/Clippy, and **31 default Rust tests** (two opt-in installed-Pi tests remain ignored). `mise run build` packages the local macOS app. `npm run test:browser` passes **12 offline WebKit tests**.
- Project-scoped native window geometry is saved on orderly close/quit and restored with bounds/missing-display fallback. Geometry unit tests cover scope and validation, not native placement. File polling/emission through a running Tauri app, multiple native windows, macOS multi-display/DPI/maximization, and Windows/Linux behavior still require acceptance.
- No user app/window was launched or interrupted. No live Pi request, paid model turn, or user-session mutation was made. Browser automation used isolated offline fixtures only.

Manual acceptance: restart the new build when convenient; check Settings' resolved paths, edit `appearance.theme`/`appearance.zoom` in a text editor, and confirm open project windows synchronize. Make an invalid edit and fix it; confirm the last valid values remain and the Settings gear error clears. Edit Runtime with unsaved fields to check preservation and next-launch snapshots. Resize/move a project window, close/reopen it, and check normal/maximized restoration, including a removed display. These steps do not require starting Pi.

## Project terminology

- User-facing workspace labels are now **Project**, **Open project…**, **Recent projects**, and **Project bar** in the UI, accessibility text, CLI help/errors and current documentation. Internal identifiers, IPC commands, window labels, launch flag and storage keys are unchanged; no state migration or worktree-aware grouping was introduced.
- Shell regressions verify the Open project palette command, project-scoped session search text, recent-project accessibility label, welcome/empty-project copy, and continued use of the existing recent-directory storage key. Launcher/native tests verify project help and directory-validation errors while retaining `--workspace` launch compatibility.
- `mise run check` passes: **191 TypeScript/Node tests**, Rust formatting/Clippy and **22 default Rust tests** (two opt-in real-Pi tests remain ignored). `mise run build` packages the local macOS app successfully. Bash syntax and launcher help also pass.
- No app/window was launched or interrupted, no browser was used, and no live Pi/model request or user-session mutation was made. Native picker presentation and visual label/layout acceptance remain for user verification. Historical increments below retain their terminology at the time of verification.

## Startup screen selection

- Welcome is hidden in the initial HTML and stays hidden while workspace initialization is pending. Normal app launches reveal it after initialization; workspace launches show a restored conversation or a separate empty-workspace view with New session and Resume session actions. Closing the last session returns to that workspace view, not welcome.
- Shell regressions cover pending startup with/without a workspace, startup failure, empty-workspace actions and last-session close. The standalone Settings fixture explicitly simulates completed normal-launch startup.
- `mise run check` passes: **188 TypeScript/Node tests**, Rust formatting/Clippy and **22 default Rust tests**. `mise run build` packages successfully. No app/window was launched or interrupted. Native absence of the welcome flash remains for user verification.

## Explicit cold-start window creation

- Automatic configured-window creation is disabled. Setup explicitly chooses either a workspace window for a CLI directory request or the welcome window for a normal launch; it no longer creates a welcome window before routing a cold CLI request.
- A native configuration regression ensures no window is automatically created and the normal-launch welcome configuration remains available.
- `mise run check` passes: **185 TypeScript/Node tests**, Rust formatting/Clippy and **22 default Rust tests**. `mise run build` packages the local macOS app successfully.
- The user confirmed `nimrod .` now opens only the workspace window after a full quit. The maintainer did not launch or interrupt the app or start a Pi session. The user subsequently reported a brief frontend welcome-screen flash, addressed by the startup-screen increment above.

## Model/thinking palette increment

- `mise run check`: **177 TypeScript/Node tests**, Rust formatting/Clippy and **21 default Rust tests** pass. `mise run build` packages successfully.
- Fresh-session regression starts without a selected model, with an unwritten file, and verifies model selection followed by thinking-level selection without a prompt or first save. Scope filtering, retained drafts, current-value markers, cancellation and stale-page protection are covered.
- **6 WebKit tests** pass, including status-button model selection and command-palette effort selection in a fresh offline demo before any prompt. Existing streaming/scroll regressions pass.
- A metadata-only probe of installed Pi 0.86.1 in a disposable project/config with a fake fixture credential returned a model, scoped-model status, available models and supported levels on a fresh session. It sent only `get_state`, `get_available_models` and `get_available_thinking_levels`, with user resources disabled. No prompts or model requests. This does not reproduce the user's exact provider/configuration or establish native acceptance of their reported failure.
- Missing-model/empty startup metadata no longer silently disables effort selection; the shared picker explains the state and permits retry. Model/thinking errors are also surfaced outside the palette after mutation failure. The user's running app was not opened or interrupted.

## Bash CLI increment

- `mise run check` passes: **175 TypeScript/Node tests**, Rust formatting/Clippy, and **21 default Rust tests**.
- Four launcher tests use disposable directories and intercepted `exec` calls, not Launch Services or a running Nimrod app. They cover current/absolute/relative paths, spaces/Unicode/shell metacharacters, canonical aliases, dash-prefixed directories, argument/build validation, installed symlink resolution, and refusal to overwrite existing/dangling commands.
- Three native tests cover argument validation/canonical identity and startup-gated, ordered forwarding requests. CLI and GUI share the canonical workspace router. Native forwarding/focusing itself has not been exercised against the user's app.
- Bash syntax and the actual `bin/nimrod --help` entry point pass without opening a window. `mise run build` packages Apple Silicon **Nimrod.app** successfully (approximately **12.83 MiB**).
- No CLI symlink was installed into the user's PATH, shell configuration changed, or app/window launched/interrupted. Browser and installed-Pi tests were not rerun for this native/launcher change. No session was started, resumed or mutated during validation.

Manual acceptance: restart the new app build once, install the launcher, run `nimrod .` from a project directory, repeat it from a different terminal directory using an absolute path, and confirm the same workspace window is focused. Check a second directory, spaces/symlinks and a minimized/hidden workspace. No Pi session should start. Cold start, native focus/forwarding, simultaneous cold starts and Windows/Linux platform behavior remain unverified by these fixture tests.

## Sidebar-first command palette increment

- `mise run check` passes: **171 TypeScript tests**, Rust formatting/Clippy, and **18 default Rust tests**.
- Palette coverage includes keyboard and pointer selection, name/preview/path filtering, two-step Escape, focus restoration, stale discovery results, errors/retry, IME/repeated-Enter guards, readiness/modality guards, exact-file launch without prompt replay, and Pi-dialog focus priority.
- **5 actual WebKit browser tests** pass using offline demo children: prior follow/pause/hidden-session regressions plus palette modality, continued streaming and composer focus/draft preservation. The sidebar-only UI has no tab strip or All sessions search field.
- `mise run build` packages **Nimrod.app** successfully (Apple Silicon, approximately **12.64 MiB**). Native shortcut/picker/window acceptance remains separate. No user window was opened or interrupted, no live model request was made, and no user session was mutated.

## Earlier workspace/sidebar/tab increment

- **184 TypeScript tests** cover the existing renderer/acknowledgement contracts plus directory opening without Pi, command-palette history/session navigation, duplicate-tab focus, independent live transports/drafts, background acknowledgements/dialog responses, per-token close, restored-session selection without prompt replay, shared-library draft isolation, and explicit recovery of closed temporary/demo drafts.
- **18 default Rust tests** cover transport, exact-file validation, read-only catalog discovery, independently owned children, duplicate file reservations, wrong-window access, failed spawn/shutdown, rejection of late starts after window close/quit, and sibling writes during escalated shutdown. Rust formatting/Clippy pass.
- **4 actual WebKit browser tests** pass using independent offline-demo children and mocked Tauri IPC: repeated fractional-zoom follow, explicit pause/resume, live background tabs with draft isolation/sidebar resize, and older-history offsets across hidden-tab streaming. All renderer IDs are unique in the multi-tab fixture.
- `mise run check` and `mise run build` pass; the Apple Silicon **Nimrod.app** packages at approximately **12.64 MiB**. No user app/window was opened, reloaded, or interrupted. No live model request or user session mutation was used for testing. Installed-Pi smoke tests were not rerun for this increment.

Native Tauri multi-window routing, picker/relaunch acceptance and platform menu shortcuts still need manual acceptance. Browser/jsdom/subprocess evidence does not establish them.

## Earlier automated evidence

- **156 TypeScript tests pass**: imported reducer/composer/tool/scroll tests plus Nimrod transport, session coordinator, renderer-bridge, link sanitizer, complete shell-bundle tests, and session draft storage. Persistence coverage includes explicit saved/resume launch, delayed/absent identity, exact-file history, missing/incorrect targets, startup extension editor ordering, legacy/provisional recovery, draft isolation, uncertain submissions without replay, storage failure, and shutdown-before-switch with late old receipts.
- Fluid-width regression passes in a local Chromium headless-shell layout fixture at 560, 960, 2560 and 5120 CSS pixels, then back down to 960/560. All four conversation surfaces follow available width, retain 20px side padding, and avoid document horizontal overflow. Run `CHROMIUM=/path/to/chrome-headless-shell node scripts/check-fluid-layout.mjs`. This is real browser geometry, not native WebKit acceptance.
- Theme regressions cover built-in selection, JSON/JSONC imports, source formats and size/count bounds, color-only validation, syntax mapping, duplicate names, local persistence/removal, canceled/failed/stale imports, and retained transcript DOM/focus/drafts/scroll. A local Chromium headless-shell fixture checks actual Dracula/imported-light colors and restoration under both light/dark CSS cascade branches, including workspace-bar fit at 1000px and 280px. Run `CHROMIUM=/path/to/chrome-headless-shell node scripts/check-themes.mjs` (optional `VIEWPORT_WIDTH=280`).
- Settings regressions cover gear/⌘/Ctrl-comma navigation, native cancel wiring, priority of Pi dialogs, runtime Save/migration/validation/failure behavior, retained live transcript state, and startup finishing without stealing Settings focus. A local Chromium fixture at 1000px and 280px verifies actual full-page geometry, native dialog focus containment/restoration, unchanged background pane geometry, live rendering and spinner identity, older-history scroll/drafts, appearance changes and next-session runtime snapshots. Run `CHROMIUM=/path/to/chrome-headless-shell node scripts/check-settings.mjs`. Animation frames are driven by fixture timers; this is not a native animation-timing or WebKit acceptance claim.
- **2 Playwright WebKit tests pass** with actual browser frames/events and the real offline demo subprocess through a mocked Tauri boundary. They cover repeated demo turns at fractional layout scale and genuine upward scrolling/pause/return-to-bottom. The fixture uses CSS zoom at 125% with DPR 2, not native Tauri `setZoom`; actual WKWebView acceptance remains separate. No model requests, external page loads, or user-session activity. Run `npm run test:browser` after `npx playwright install webkit`.
- Rust formatting and **Clippy (`-D warnings`) pass**.
- **10 default Rust tests pass**: JSON record validation, LF/CRLF/Unicode framing and size limits, owned-process start/stop and stale tokens, malformed-output shutdown, link parsing/argument separation, a real subprocess demo, and exact-session validation/launch arguments/canonical file and project aliases.
- **2 opt-in installed-Pi tests pass** against Pi 0.86.1. The original checks temporary startup, scope bridge, metadata/history, and shutdown. The persistence smoke checks a new saved session's intended-but-not-yet-written file, then exact resume of a hand-authored fixture through two launches; a fixture-only `set_session_name` verifies Pi writes and reloads its own metadata. Both isolate config/projects/session files and disable user resources/startup networking. No prompts, compaction, paid requests, or live user sessions. This does not test a real provider-generated first response.
- The full application compiles and packages as an Apple Silicon **Nimrod.app**, approximately 12.2 MiB. Bundle contains the executable, icon, offline fixture and read-only Pi scope bridge; frontend assets are embedded by Tauri.
- npm dependency audit reported no vulnerabilities at installation.

`mise run check` runs the default checks. The opt-in Pi smoke command is in README.md.

## Evidence boundaries

The renderer and shell-bundle tests run under jsdom with a mocked native boundary. Rust process tests use real pipes/subprocesses. Neither establishes live WKWebView focus, scroll geometry, animation timing, clipboard permissions, native dialogs, Finder-launch runtime discovery, or actual editor activation.

The user has tried the initial native app and reported the wide-screen status-border and zoom issues. The maintainer's automated checks have not launched or interrupted that app or the user's VS Code window, and no paid model turn was run. Windows/Linux builds and native behavior are unverified.

The user subsequently confirmed the zoom improvement and requested fluid content width; the fixed-width column and status centering calculation have now been removed. The separate launch form and dialogs remain compact.

The border/zoom change adds tests for native zoom IPC, 125% default and saved values, keyboard stepping/reset/bounds, serial requests, native failure recovery, unchanged focus/drafts, required Tauri permission, and the full-width status CSS contract. These are mocked-native/jsdom checks, not a claim of live 5K/WebKit geometry or zoom acceptance.

The theme importer uses the webview's native file chooser. Its chooser interaction and actual WebKit rendering still need native acceptance; browser fixtures do not replace that check. Theme changes and imports never start/restart Pi or submit messages.

## Fractional-zoom auto-follow regression

The offline demo reproduced a WebKit scroll offset changing from 132 to 131 while the maximum remained 132. The old scroll handler treated any upward change as user navigation, canceled a pending follow, and latched `interrupted`. Later turns then accumulated below the viewport. A test-bundle-only restoration of that old condition failed the browser regression on turn 2 with a 309px bottom gap; the fixed handler passes all four turns.

The fix narrowly tolerates ≤2px movement when both old/current positions denote the bottom. Explicit wheel/touch/key intent and meaningful upward scrollbar movement still pause following. Unit tests cover 0.4/1/2px settlement, pending-frame retention, and real navigation precedence. No diagnostic hooks or polling were added to the running application. Browser failure traces are local generated files ignored by Git.

## Manual acceptance to perform

For the sidebar-first UI: open a directory without starting Pi. Confirm the sidebar shows only New session and a flat session list—no repeated directory, Open sessions disclosure, or secondary actions. Press **Cmd/Ctrl+Shift+P**, select **Resume session…**, filter by name/preview, then verify Escape returns to commands before closing and restoring focus. Use the palette to open a second **offline demo** session, switch with **Cmd/Ctrl+Shift+[ / ]** while one runs, and confirm independent drafts/disclosures/scroll state. Close one session and confirm its sibling remains usable. Open another directory in a new window; reopening the same directory should focus that window. Closing it must leave the first window and its agents intact. Once intentionally using persistent sessions, reopen the workspace and verify remembered sessions do not start until selected, then load automatically without submitting a prompt. Check all shortcuts against native menu behavior.

Earlier acceptance checklist (still applicable per tab):

1. Open the packaged .app from Finder (not only a terminal). Confirm runtime discovery and choose this repository as the project.
2. Open Settings with the gear and ⌘/Ctrl comma. Check Appearance controls, Back/Escape navigation, and that streaming continues without resetting the draft, open cards or transcript position. Save alternate Runtime paths and verify the current process is unchanged; only a later launch uses the new paths. Check that the app starts at 125%, that Settings → Appearance → Zoom and ⌘/Ctrl +/−/0 work, and that zoom survives relaunch. Drag between narrow and ultrawide window sizes: transcript, status content, notices, and composer should follow the available width with only a 20 CSS-pixel side gutter, and both status borders should reach the edges. Change zoom while following live output and while reading older history. Start the offline demo, send a message, and inspect real streaming/scrolling/disclosure animation. Confirm sustained output auto-opens while fast/final output does not; explicit disclosure wins. At 125% zoom, run several demo turns and confirm auto-follow continues; then deliberately scroll up and back down to check pause/resume.
3. Type a newer draft before acknowledgement, steer during the fixture run, and Stop. Confirm exact queue text is recoverable.
4. Copy a code block and open the demo's README link in an already running VS Code window; verify line navigation and no duplicate open.
5. Open model/thinking dialogs. Verify keyboard selection, Escape/cancel, focus, and normal Cmd+C/Cmd+V editing.
   Also use Settings → Appearance to switch Nimrod ↔ Dracula, import a standalone VS Code JSON/JSONC theme through the native file chooser, cancel another import, relaunch to check persistence, and remove only the local imported copy. Confirm live cards/drafts/scroll are retained during theme changes.
6. Disconnect, start another demo, and ensure no old events/drafts are silently submitted. Close the window and quit; confirm the owned fixture process exits.
7. Choose **New session** when intentionally ready for live work. Confirm **Pi · awaiting first save**, then **Pi** after an actual assistant message is persisted; hover for the exact path. Verify scoped models/extensions; a prompt is real provider work. Once idle, reopen the built app and explicitly choose **Resume last session**. Confirm the same file/project/history and its unsent draft; no prompt should be submitted on launch. Also exercise the native **Resume session file…** picker, cancel, wrong-project/missing-file failures, and explicit temporary/demo isolation. These persistence launch/picker flows still need native acceptance; automated checks did not open or interrupt the user's window.

## Known PoC limitations

- No automatic Pi resume, process continuity across quit, or session deletion. Resume restores active-context history, not every tree branch or pre-compaction entry.
- Catalog discovery reads Pi's default encoded workspace directory or session-directory environment override. Arbitrary custom locations and differently encoded symlink-directory aliases require exact-file open. Workspace preference changes are not live-synchronized across already-open windows.
- New sessions are not resumable until Pi writes a file; a rename alone does not flush an empty Pi 0.86.1 session. Existing temporary conversations are not retroactively saved.
- Scoped draft libraries (including their embedded last-session pointers) still use browser storage; the separate global last-session pointer now lives in app-managed state. Failures are surfaced, not a durable-draft guarantee. Unassigned/legacy recovery sources are retained. External writers/file mutation are not excluded by Nimrod's process slot or read-only validation.
- Kill-on-drop is not cleanup after arbitrary OS-level parent death. Detached descendants are not tracked or guaranteed terminated.
- Open file links, not automatic linking of all path-looking text. File targets must exist. Only VS Code handoff is implemented.
- Windows Pi npm `.cmd` wrappers need a JS entry-point selection; editor launching and packaging still need Windows acceptance.
- No signing/notarization or installer/update pipeline. The macOS packaging task is intentionally platform-specific for this first milestone.
