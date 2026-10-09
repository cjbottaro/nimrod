# PoC verification

## Session creation and navigation shortcut defaults

- New is Cmd/Ctrl+N only; New named is Cmd+Option+N / Ctrl+Alt+N; Temporary remains Cmd/Ctrl+Shift+N. Switch session is Cmd/Ctrl+T only, Resume session is Cmd/Ctrl+K, and Cmd/Ctrl+P is unbound. Existing explicit user overrides remain unchanged; action/all reset restores these updated defaults.
- Unit/shell coverage checks conflict-free defaults, distinct open-session/history/naming pickers, no accidental launches, literal named-session creation, draft preservation, unbound Cmd+P, modal/IME/repeat guards and override precedence. Both targeted offline WebKit keybinding tests pass, including direct shortcut delivery and cancellation/focus preservation; the complete browser suite was not rerun for this defaults-only update.
- `mise run check` passes **327 TypeScript/Node tests**, formatting/Clippy and **73 default Rust tests** (two opt-in Pi smokes ignored). `CARGO_TARGET_DIR=<repository>/src-tauri/target/keybindings-check mise run build` packages and verifies the signed macOS app without replacing the default/running bundle. Browser artifacts are isolated at `/tmp/nimrod-session-shortcuts-browser`.
- No user app/window launch/interruption, live Pi/model request, real-session deletion or upstream extension change occurred. Native shortcut/menu/layout acceptance and Linux/platform verification remain separate from automated fixture/WebKit evidence.

## Customizable keybindings

- Settings → Keybindings lists Nimrod actions, records single-keystroke shortcuts without execution, exposes explicit conflict reassignment, unbinding and per-action/all reset. Only overrides persist in JSONC; valid external edits synchronize across windows. Your requested New/Temporary/Delete/Model/Effort defaults are included; Cmd/Ctrl+T remains a compatibility alias for New.
- One project-shell dispatcher preserves modal/IME/repeat priority and routes to existing lifecycle/model/deletion methods. Cmd/Ctrl+Backspace opens the normal review rather than deleting immediately. Native Minimize/Close Window remain menu actions without competing accelerators. Composer delivery, Pi keymaps and pop-out shortcuts are unchanged.
- `mise run check` passes **326 TypeScript/Node tests**, formatting/Clippy and **73 default Rust tests** (two opt-in real-Pi smokes ignored). All **25 offline WebKit tests** pass, including recording/reassignment/reset and retained session DOM/draft/disclosure. Browser output is isolated at `/tmp/nimrod-keybindings-browser-final`.
- `CARGO_TARGET_DIR=<repository>/src-tauri/target/keybindings-check mise run build` succeeds and verifies the signed macOS artifact at **`src-tauri/target/keybindings-check/release/bundle/macos/Nimrod.app`**. A separate target avoids replacing the default/running app bundle. Counts reflect the combined checkout, including concurrent sidebar work; existing staged/unstaged changes were preserved.
- No user app/window was launched or interrupted, no live Pi/model request or real session deletion occurred, and no installed extension, OS setting, permission or notification was changed. Native Cmd+M/menu execution, alternate keyboard layouts, macOS visual/focus acceptance and Linux/possible Windows platform verification remain for user validation.

## Sidebar row trash action

- Every sidebar row has a trash button immediately left of Close. It targets that row's saved session tree through the existing immediate loading/tree-confirmation flow, without selecting or resuming the row. Close remains non-destructive for saved history. Eligibility is shared with the Project bar action, including a live pending-send guard that does not misuse reload restoration.
- Shell fixtures cover background targets, duplicate clicks, cancellation, success/partial failure, confirmed-only row/draft cleanup, retained selection/draft, unsaved/temporary/busy/pending/quarantined guards and acknowledgement-only eligibility refresh. Offline WebKit verifies left-of-Close placement/alignment at minimum sidebar width, accessible labels, whole-row transparent hover and disabled demo behavior in both views.
- `mise run check` passes **314 TypeScript/Node tests**, formatting/Clippy and **71 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages and verifies the macOS bundle; all **24 offline WebKit tests** pass. These are combined-checkout totals.
- Verification was automated only, as requested. No manual app testing, user app/window launch/interruption, real session deletion, installed-extension change, live Pi/model request or OS notification occurred. Native/plugin/platform acceptance was not performed or inferred from fixtures.

## Resizable session sidebar

- A draggable right-edge handle resizes the sidebar, with keyboard steps/bounds, double-click default reset and Escape cancellation. Preferred width is stored independently per canonical project in app state. Temporary window/zoom limits do not overwrite it; hide/show preserves it and narrow windows keep the existing overlay behavior.
- Unit/shell fixtures cover validation, project isolation, writes only after completed drags, cancellation, responsive clamping, keyboard/accessibility, modal/hidden guards and no settings/harness operations. Offline WebKit at 125% zoom verifies real drag geometry, persistence/restoration, overlay edge alignment, outside-viewport pointer capture, retained drafts/disclosures/focus, live follow and paused older-history reading during later streaming.
- `mise run check` passes **312 TypeScript/Node tests**, formatting/Clippy and **71 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages and verifies the macOS bundle; all **23 offline WebKit tests** pass. Browser artifacts use isolated `/tmp` directories.
- No user app/window was opened or interrupted, no real Pi/model requests or OS notifications were made, and no installed extensions or user sessions were modified. Native Tauri visual/pointer/zoom acceptance and Linux/Windows verification remain for user validation.

## Native macOS foreground presentation acceptance

- On **macOS 27.0.1 (26A434)**, the user confirmed that the signed diagnostic build's foreground test alerts become visible after changing Nimrod's OS alert style from **Temporary** to **Persistent**. Signed Notification Center delivery was already accepted. Temporary remained inconsistent with authorization/desktop/center enabled and Focus off.
- A later read-only refresh showed **2 actual foreground-handler calls**; the immediate post-submit zero was timing, not a missing callback. Passive OS logs independently confirm `Presentation reply ... ["list", "banner"]`, usernoted choosing banner presentation, and DND suppression none. An inert Swift content probe reports default interruption level Active without accessing the notification center or sending anything.
- Persistent foreground **test-alert** acceptance is user/native evidence, not a claim from fixtures. The remaining Temporary presentation/cache cause is unproven, as is any intentional macOS 27 policy change. Do not force a native flag/urgency workaround or OS-style override based on this observation. Persistent is the documented user-controlled workaround; other events/platforms still require their own acceptance.
- No additional production code, app rebuild/restart, OS-setting change, notification dispatch, permission reset, certificate/Keychain operation, model request or user-session mutation was performed by the assistant for this A/B result. The user changed style and sent the test explicitly. Prior checks/build/signature verification and offline regression results remain recorded below.

## Foreground notification callback diagnostics

- The user confirmed signed manual-test delivery to Notification Center, with Temporary style, desktop/center/lock-screen enabled and Focus off. One real completion later displayed a banner without a restart, then another foreground completion was center-only. The latest native edits were staged separately and not active in that running app; they cannot be credited for the successful banner.
- The diagnostic build installs the retained delegate during native app setup rather than first dispatch. Read-only Refresh notification diagnostics and post-test metadata report UN authorization, desktop alert setting/style, center setting, app-active state and cumulative actual foreground-handler calls (Banner | List). Reads remain available with alerts off and never request permission/send/start a process. Diagnostic lookup failure does not relabel an accepted test as failed.
- `mise run check` passes **296 TypeScript/Node tests**, Rust formatting/Clippy and **71 default Rust tests** (two opt-in Pi smokes ignored). **20 offline WebKit tests** pass with an isolated output directory. `CARGO_TARGET_DIR=<repository>/src-tauri/target/notification-banner-check mise run build` succeeds and verifies the signed artifact at **`src-tauri/target/notification-banner-check/release/bundle/macos/Nimrod.app`**. Totals include concurrent local feature work.
- Read-only platform checks establish macOS **27.0.1 (26A434)**. Apple's macOS 27 notes do not document a new foreground-banner ban; the SDK retains the same delegate selector/Banner/List flags. Current Apple docs explicitly require pre-launch delegate assignment and warn late installation may miss notifications. Pinned Tao/Tauri startup source ordering supports placing initialization in setup. No undocumented OS policy/regression or startup-registration fix is claimed proven.
- No running bundle was modified/restarted or app/window launched by these commands. No actual notification/authorization prompt, paid Pi/model request, user-session mutation, certificate/Keychain/permission reset or OS-setting change was made by tests/tools. Next acceptance is a user-directed restart into the staged signed diagnostic build, then Send test notification and a later read-only refresh. Record actual handler count and API policy; do not infer per-request visible delivery from the cumulative counter.

## Prompt-only recency: rename exclusion

- All's recency hook is now `SessionUi.promptAccepted`, invoked only after a successful Pi `prompt` RPC. `/name` still updates the title and clears its unchanged submitted draft on acknowledgement, but never updates last-used timestamps or reorders the sidebar. Compaction and other metadata/control acknowledgements also do not count. No Pi/runtime/extension changes are required.
- Controller tests cover inline/dialog rename success, canceled/rejected/unknown renames, subsequent real prompts, ordinary/steering/follow-up acceptance and compaction exclusion. Shell tests verify unchanged persisted timestamps/order after rename; offline WebKit verifies unchanged row order and scroll before a subsequent real message moves that session to the top.
- `mise run check` passes **294 TypeScript/Node tests**, formatting/Clippy and **70 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages and verifies the local macOS bundle; all **20 offline WebKit tests** pass. Counts reflect the combined checkout.
- No real Pi/model request, OS notification, user-session mutation, installed-extension change or app/window launch/interruption occurred. Native visual/focus acceptance and Linux/Windows verification remain separate.

## Immediate session-deletion loading dialog

- Delete opens the modal synchronously before native IPC, showing a reduced-motion-aware **Loading session tree…** spinner with Delete disabled. Preview replaces the contents in place without moving Cancel focus. Cancel/Escape during loading suppresses late review; preview/shutdown cleanup continues under the existing native launch barrier. Preview failures close the loading surface.
- `mise run check` passes **292 TypeScript/Node tests**, formatting/Clippy and **70 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages and verifies the default macOS bundle; **20 offline WebKit tests** pass. New loading-specific coverage uses delayed-preview shell and dialog/coordinator unit fixtures; WebKit covers the existing tree modal/focus/scroll behavior.
- No user app/window was launched, no live Pi/model request or installed-extension execution occurred, and no real session was deleted. Immediate native visual behavior and Linux/Windows acceptance remain for user validation.

## macOS notification signing correction

- The user's explicit test returned `UNErrorDomain / 1` (NotificationsNotAllowed). The prior app artifact failed strict signature verification: its executable retained only `adhoc,linker-signed`, an identifier unlike `dev.nimrod.desktop`, unbound Info.plist and no sealed bundle resources. This is a concrete packaging defect, not evidence that the user left an OS toggle off. UserNotifications requires application signing.
- Tauri packaging now requests whole-bundle local ad-hoc signing. `mise run build` runs a read-only signature gate rejecting linker-only signatures, incorrect signing identity and unbound/unsealed application metadata. Native errors now distinguish authorization from submission. No certificate/Keychain change, permission reset or notarization is added.
- `mise run check` passes **289 TypeScript/Node tests**, Rust formatting/Clippy and **70 default Rust tests** (two opt-in Pi tests ignored), including signature-regression fixtures. Counts include concurrent local features. No browser rerun for this packaging/native-error-only correction; the prior isolated 20-test offline WebKit run passed.
- To avoid signing/replacing the user's running app in place, the existing release cache was copied to a separate target. **`CARGO_TARGET_DIR=<repository>/src-tauri/target/notification-signing-check mise run build`** successfully built, ad-hoc signed and verified **`src-tauri/target/notification-signing-check/release/bundle/macos/Nimrod.app`**. `codesign --verify --strict` succeeds; inspection shows `Identifier=dev.nimrod.desktop`, `adhoc,runtime` without linker-signed, bound Info.plist and sealed resources. Ordinary future `mise run build` uses the same signing/verification at the default target.
- Neither the running app nor OS settings were changed; no app was launched/restarted, no real OS notification/permission request or paid model request was made, and no user sessions were mutated. Remaining acceptance: quit the old Nimrod explicitly, open the separately signed artifact, and use Send test notification. Because single-instance routing can otherwise bring forward the old process, opening the new artifact while the old app is running is not a valid test. Signature validity is established; actual OS receipt remains unverified. Ad-hoc identity/permissions may need a fresh grant after rebuilding.

## All sidebar send-only recency and scroll intent

- All is most-recently-used first: only Pi-acknowledged sends update per-session last-used timestamps. Row/palette/cycling selection and New/Resume leave ordering unchanged; the initial selection-driven implementation was corrected after user feedback. Saved open entries retain recency across reopening; legacy ties keep open order. Background activity/completion, uncertain/rejected submissions, restoration and automatic Close/deletion replacement do not update recency. Needs attention retains its independent arrival order.
- Row movement preserves a surviving visible sidebar anchor, excluding the moved session; it never chases that row to the top. Explicit palette/shortcut/New/Resume navigation and returning to All reveal the selected row. Mounted conversation/draft/focus stay unchanged on background acceptance.
- `mise run check` passes **287 TypeScript/Node tests**, formatting/Clippy and **70 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages successfully; all **20 offline WebKit tests** pass. Totals include concurrent local notification work; this recency change made no Rust edits.
- Recency fixtures cover saved layout reopening, malformed/legacy values, monotonic ties, unchanged order/timestamps on row/palette/cycling selection, accepted/rejected/unknown submissions, unchanged child ownership and a 15-session delayed-acknowledgement scenario at 125% zoom with real sidebar geometry. A first focused browser run collided with another run's shared output directory; subsequent focused/full runs passed using isolated `/tmp` output directories.
- No user app/window was opened or interrupted, no live Pi/model requests or real OS notifications were made, and no installed extension or real session was modified. Native visual/focus acceptance and Linux/Windows verification remain for user validation.

## macOS notification backend replacement

- User acceptance of the previous legacy backend failed: background runs in All produced neither a banner nor a Notification Center entry, with Nimrod and macOS notification settings enabled. The actual failing stage was not observable because the plugin discarded native delivery errors. Earlier mocked/runtime tests were not delivery acceptance.
- macOS now uses UserNotifications directly with real packaged-app identity, explicit authorization, a retained Banner/List delegate and awaited submission/error callbacks. The legacy presentation hook is removed. Linux/Windows keep the existing plugin path and remain unverified.
- Settings now offers **Send test notification** with fixed content and no agent/model operation. Last-attempt status distinguishes quiet reasons, authorization, submission, native suppression and errors; native macOS errors also appear in the project error area. Permission waits are followed by fresh originating-session focus/selection/lifecycle checks.
- Final `mise run check` passes **287 TypeScript/Node tests**, Rust formatting/Clippy and **70 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the macOS app. Read-only inspection confirms UserNotifications.framework linkage and the expected `dev.nimrod.desktop` bundle identifier. Totals include concurrent local feature work.
- **20 offline WebKit tests pass** with a unique temporary Playwright output directory, including All/Working → background Completed preparation/dispatch and the manual Settings test/off policy. Earlier shared-output runs encountered concurrent sidebar-order changes and missing Playwright trace artifacts; the isolated final run passed. Notification test selectors use originating panel identity rather than mutable sidebar indexes.
- No actual OS notification, permission request, user-app launch/restart/interruption, live Pi/model request, user-session mutation, upstream extension change or OS-settings change was performed. Native unit tests never initialize the real notification center. Remaining acceptance: manually restart the packaged build when convenient, use the Settings delivery test, and validate background completion while another session is presented. Accepted submission is not proof of visible delivery; report the exact status/error if absent.

## Deletion dialog modal-style consistency

- Deletion review and the command palette now share their themed modal surface, border/radius/shadow, backdrop, padding and placement. Deletion uses the palette's heading size and compact spacing; only its tree scrolls, leaving action buttons visible. Confirmation/deletion behavior is unchanged.
- Offline WebKit compares actual computed styles in default, Dracula and system-light themes, preserves Cancel-first focus during theme updates, and verifies footer visibility after scrolling a 101-session tree. No deletion worker is executed in the browser fixture.
- `mise run check` passes **279 TypeScript/Node tests**, formatting/Clippy and **69 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages successfully; all **18 offline WebKit tests** pass.
- The user app/window was not opened or interrupted, and no real session files or installed extensions were modified. Native visual acceptance remains for user validation.

## Custom session-tree deletion and reconciliation

- Delete session tree now uses an app-owned, scrollable nested-tree dialog with concise copy, Cancel-first focus and a counted Delete button. Confirmed subtree removals are reconciled idempotently from events, command results and success snapshots, fixing the event-only ghost-entry path.
- Confirmed successes remove mounted entries, file-scoped drafts/recovery text, remembered pointers and saved pop-out references/windows/files. Failed/unknown scopes retain state. Selection happens once after batch removal: next/previous in the active sidebar view, Needs attention → All fallback, then the empty project if no sessions survive. Ordinary Close retains its separate view behavior.
- `mise run check` passes **279 TypeScript/Node tests**, Rust formatting/Clippy and **69 default Rust tests** (two opt-in Pi smokes ignored). `mise run build` packages the macOS app; **18 offline WebKit tests** pass, including modal tree scrolling, cancellation, focus and correlated answers.
- All deletion tests use mocked IPC or disposable fixtures. No user session tree, installed extension or sibling Pi GUI was modified, no live Pi/model request was made, and no user app/window was launched or interrupted. Native installed-extension deletion, real cross-window outcomes and Linux/Windows acceptance remain for user validation.

See [session deletion](workspace-sessions.md#delete-session-tree) and its [implementation reference](../.agents/skills/features/references/session-deletion.md).

## Blank Needs attention conversations

- Needs attention shows a conversation only for a selected inbox row. Switching from a working/idle session without attention leaves the conversation area blank; completion adds an unread row without opening it. Explicitly visited completed rows stay visible while read. Hidden sessions remain mounted/running, retaining drafts, disclosures and scroll intent.
- Blank views hide transcript/status/composer and empty-project prompts, clear the mode badge, disable Restart/Delete and have no hidden session-command/Close target. Explicit navigation to a filtered-out session switches to All; automatic Close/deletion replacement stays in the current view. Pop-outs and unread/notification eligibility use the shown conversation, not the remembered navigation target.
- `mise run check` passes **279 TypeScript/Node tests**, Rust formatting/Clippy and **69 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the macOS app; **18 offline WebKit tests** pass, including real draft/disclosure/reader-position restoration, working-view blanking, arrival order and reduced-motion behavior. An intermediate check hit concurrent Rust formatting edits; the final rerun passed without formatting those files as part of this UI change. Totals include concurrent local deletion work.
- No user app/window was launched or interrupted, no live Pi/model request or real OS notification was made, and no user-session mutation occurred. Native visual/focus/pop-out acceptance and Linux/Windows verification remain outstanding. Please validate switching a working offline demo into Needs attention, selecting its completed row, and returning to All in the packaged app.

## Notification response previews

- Completion banners now preview the latest finalized assistant text, with Markdown converted to plain text and whitespace compacted. Previews are capped at 1,000 Unicode characters; the OS determines visible capacity. Input/failure alerts remain generic; reasoning, user messages, tool-result records, dialog content and raw errors are not preview sources.
- Coverage includes latest-response extraction, run resets, failure exclusions, Markdown/unsafe HTML/media removal, Unicode-safe truncation, nonfatal conversion failure, native normalization/fallback and shell dispatch. The offline WebKit background-completion test records a response preview without emitting an OS notification.
- `mise run check` passes **266 TypeScript/Node tests**, Rust formatting/Clippy and **67 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the macOS app; **16 offline WebKit tests** pass. Totals include concurrent local feature work.
- No user app/window was launched or interrupted, no real OS notification was emitted, and no live Pi/model request, user-session mutation or settings change was made. Actual banner truncation/expansion and lock-screen presentation remain OS/platform acceptance, separate from fixture evidence.

## Disposable temporary sessions

- Temporary/offline-demo composer state is memory-only, excluded from sibling library writes and recovery. Successful Close discards it after owned shutdown and view disposal; Cancel/failed shutdown retains the live draft. Older persisted temporary/demo entries are ignored and removed on the next library write. Saved-session drafts/history are unchanged.
- Unit/shell fixtures cover confirmation wording, cancellation, failed-stop retention, cleanup, no late resurrection, sibling isolation, absence of temporary text from browser storage and runtime pop-out owner retirement. `mise run check` passes **262 TypeScript/Node tests** and **66 default Rust tests** (two opt-in Pi tests ignored); `mise run build` packages the macOS app; **16 offline WebKit tests** pass.
- No user app/window or actual user-session state was accessed or modified. Native Close confirmation and runtime pop-out destruction still require user acceptance. Earlier recovery-of-temporary-drafts evidence below describes superseded behavior.

## Historical macOS foreground notification hook (superseded)

The hook below failed later user acceptance and has been removed in favor of the UserNotifications backend. Its runtime tests established method installation only, not native delivery.

- The user observed a background-session completion in Notification Center but no popup while Nimrod was foregrounded. The pinned macOS backend delegate lacks the optional foreground-presentation selector.
- Nimrod now adds that missing selector before eligible native dispatch, requesting presentation without replacing the existing delegate/callbacks or bypassing session suppression, OS notification style, Focus or Do Not Disturb. Linux/Windows dispatch is unchanged.
- Objective-C runtime-fixture tests verify YES presentation and preservation of existing methods without sending actual notifications. `mise run check` passes **258 TypeScript/Node tests**, Rust formatting/Clippy and **66 default Rust tests** (two opt-in Pi tests ignored), including other concurrent local feature work. `mise run build` packages the macOS app, and read-only symbol inspection confirms its backend delegate is linked.
- No user app/window was launched or interrupted; no live Pi/model request, user-session mutation, OS notification or OS-settings change was performed. Browser tests were not rerun for this native-only correction. User acceptance remains: after restarting the packaged build, finish session A while viewing session B and confirm a banner, with Nimrod notification style set to Banners/Alerts and Focus not suppressing it. The selected/focused session should remain quiet.

## Session tree deletion

- Project-bar trash icon and **Delete session tree…** palette action integrate the installed Pi GUI v1 deletion bridge. No plugin/upstream changes or native filesystem-deletion fallback. Temporary/unsaved/busy sessions are unavailable; affected windows report locks, fresh idle state and draft disclosure before native confirmation and observed token-scoped shutdown.
- Fixture coverage includes command provenance/unpersisted worker checks before prompts, correlated status versus generic acknowledgement, single-use tokens, changed/incomplete/disconnected results, busy/unreported cross-window writers, partial cleanup, durable/corrupt quarantine, explicit recovery, cancellation, and completion/start publication ordering. Native subprocess tests use a synthetic Node protocol fixture, never Pi or the installed delete plugin; simulated success leaves fixture files intact to verify the host has no deletion fallback.
- `mise run check` passes **258 TypeScript/Node tests**, formatting/Clippy and **59 default Rust tests** (two opt-in real-Pi tests ignored). `mise run build` packages the macOS app. **16 offline WebKit tests** pass, including the visible disabled demo trash icon and existing session/scroll/focus regressions.
- No user app/window was opened or interrupted, user session deleted, installed plugin modified/executed, live Pi/model request sent, or sibling Pi GUI changed. Actual installed-plugin execution, native confirmation presentation/focus, multi-window deletion/close races and platform behavior remain unaccepted. Do not infer those from the protocol/mocked-IPC fixtures.

## Attention empty-view working indicator

- An empty Needs attention view now shows the singular/plural count of live busy sessions (including compaction) and a gentle CSS ellipsis pulse. It shows no-attention text only at zero; working sessions do not enter the inbox or increment its attention badge. Unchanged streaming snapshots preserve status/ellipsis nodes, and reduced-motion preferences disable the animation.
- The shell regression verifies counts, stable DOM, `agent_end` versus authoritative settlement, compaction, selected-row retention and unchanged child ownership. All **16 offline WebKit tests** pass, including actual pulse/reduced-motion CSS and working-to-idle transitions. `mise run build` packages successfully.
- Latest `mise run check` passes **255 TypeScript/Node tests** (including concurrent deletion work), then stops on unrelated Rust formatting in `src-tauri/src/workspaces.rs`. Earlier attempts encountered intermediate deletion fixture/formatting edits; those files were not reformatted as part of this UI change. This increment makes no Rust changes and does not claim full Rust-check acceptance.
- No user app/window, live Pi/model request, user-session mutation or real OS notification was used. Native visual acceptance and Linux/Windows verification remain outstanding.

## Session sidebar attention view

- All / Needs attention filter the same open sessions. Live input, unread settled responses and session failures enter a stable arrival-order inbox; selected resolved rows remain until leaving, with the count reflecting outstanding attention only. All order and full open-session palette/cycling remain unchanged.
- `mise run check` passes **248 TypeScript/Node tests**, Rust formatting/Clippy and **47 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the macOS app. **15 offline WebKit tests** pass, including attention arrival order, selected-row retention, filtered navigation and existing scrolling/focus regressions.
- The new WebKit test initially submitted before its offline child completed startup; the helper now waits for the new session and enabled Send. The focused test and full suite passed after that fixture correction.
- No user app/window, live Pi/model request or real OS notification was used. Native visual/focus acceptance and Linux/Windows verification remain outstanding. View preference persists per project; attention reasons/order intentionally do not persist across reopening.

See [sidebar views](workspace-sessions.md#sidebar-views) and the [implementation reference](../.agents/skills/features/references/sidebar-attention.md).

## Background-session notifications

- Native alerts cover live settled completion, extension input requests and final run/process failures, including other sessions while Nimrod is focused. Selected/visible sessions stay quiet in their focused project window; intentional Stop/Close/Restart/quit, history and duplicate settled events do not generate completion/failure alerts.
- Settings → Notifications saves the default-on boolean policy through existing synchronized JSONC preferences. Banners use generic event text and explicit session names, never prompt-derived sidebar previews, transcript, dialog content or raw errors.
- `mise run check` passes **241 TypeScript/Node tests**, Rust formatting/Clippy and **47 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the macOS app. **14 offline WebKit tests** pass, with native notification dispatch mocked/recorded rather than actually delivered.
- No user app/window was launched or interrupted, no real OS notification was emitted by tests, no live Pi/model request was made, and no user session/configuration was changed. Packaged-app banner delivery, OS settings/DND, platform identity and native focus remain for user acceptance. Linux/Windows have not been built or accepted. Click-to-session routing is explicitly deferred because the current desktop plugin ignores actions.

See [notifications](notifications.md) and the [implementation reference](../.agents/skills/features/references/notifications.md).

## Project bar and session restart

- Project bar now has an icon-only **Restart session** control, disabled for temporary/demo sessions, before first verified save, with no selected session, and during lifecycle transitions. Open project moved to native **File → Open project…** (Cmd/Ctrl+O); the palette button and Disconnect action are removed. Cmd/Ctrl+Shift+P remains the palette shortcut.
- Fixture coverage: exact saved-file resume after observed token-scoped stop; preserved entry/draft; confirmation/cancel; uncertain submissions and late old receipts; duplicate restart/reselection guards; sibling process/focus isolation; disconnected restart; failed-stop retry; no fresh-session fallback on failed resume.
- Latest checkout: `mise run check` passes **238 TypeScript/Node tests**, Rust formatting/Clippy and **47 default Rust tests** (two opt-in Pi tests ignored). `mise run build` packages the local macOS app; **14 offline WebKit tests** pass. These totals include concurrent notification changes, not just this feature.
- No user app/window was launched or interrupted, no live Pi/model request or user-session mutation was made. Native File-menu/picker behavior, Cmd/Ctrl+O, saved-session restart and composer focus still require user acceptance; temporary offline fixtures cannot establish live-Pi/native acceptance.

## Pop-outs

- Project-window focus now hides the outgoing project's references and passively
  shows the incoming project's selected-session references. Focusing an owned
  pop-out retains the same scope; stale restore callbacks cannot reveal background projects.
- Current-checkout verification: **258 TypeScript tests**, Rust formatting/Clippy,
  **64 default Rust tests** (two opt-in Pi tests ignored), and a packaged macOS build.
  Includes five new project-focus policy tests and other concurrent feature work.
- **14 offline WebKit tests** passed for the earlier pop-out rendering/layout work;
  they were not rerun for native-only focus changes. Filesystem tests use disposable directories.
- Remaining native checks: ⌘\` project switching and own-pop-out focus, saved-session
  quit/relaunch, composer/dialog focus, Close versus Quit, minimization and multi-display geometry.
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

- **184 TypeScript tests** cover the existing renderer/acknowledgement contracts plus directory opening without Pi, command-palette history/session navigation, duplicate-tab focus, independent live transports/drafts, background acknowledgements/dialog responses, per-token close, restored-session selection without prompt replay, shared-library draft isolation, and, at that time, explicit recovery of closed temporary/demo drafts (superseded by the disposable temporary-session behavior above).
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

For the sidebar-first UI: open a directory without starting Pi. Confirm the sidebar shows New session, All / Needs attention view tabs and a flat session list—no repeated directory, Open sessions disclosure, or secondary actions. Let an offline session finish in the background; check attention membership/count, selected read-row retention, most-recently-used All order and access to filtered-out sessions through Switch session. Select/read a session and verify its row does not move. Send an offline message and verify only acknowledgement moves it to the top, then verify its recency survives a project reopen. Scroll down All and confirm an acknowledged submission can move a row without chasing it or shifting the visible reading anchor; returning from Needs attention to All should reveal the selected session. Press **Cmd/Ctrl+Shift+P**, select **Resume session…**, filter by name/preview, then verify Escape returns to commands before closing and restoring focus. Use the palette to open a second **offline demo** session, switch with **Cmd/Ctrl+Shift+[ / ]** while one runs, and confirm independent drafts/disclosures/scroll state. Close one session and confirm its sibling remains usable. Open another directory in a new window; reopening the same directory should focus that window. Closing it must leave the first window and its agents intact. Once intentionally using persistent sessions, reopen the workspace and verify remembered sessions do not start until selected, then load automatically without submitting a prompt. Check all shortcuts against native menu behavior.

Earlier acceptance checklist (still applicable per tab):

1. Open the packaged .app from Finder (not only a terminal). Confirm runtime discovery and choose this repository as the project.
2. Open Settings with the gear and ⌘/Ctrl comma. Check Appearance controls, Back/Escape navigation, and that streaming continues without resetting the draft, open cards or transcript position. Save alternate Runtime paths and verify the current process is unchanged; only a later launch uses the new paths. Check that the app starts at 125%, that Settings → Appearance → Zoom and ⌘/Ctrl +/−/0 work, and that zoom survives relaunch. Drag between narrow and ultrawide window sizes: transcript, status content, notices, and composer should follow the available width with only a 20 CSS-pixel side gutter, and both status borders should reach the edges. Change zoom while following live output and while reading older history. Start the offline demo, send a message, and inspect real streaming/scrolling/disclosure animation. Confirm sustained output auto-opens while fast/final output does not; explicit disclosure wins. At 125% zoom, run several demo turns and confirm auto-follow continues; then deliberately scroll up and back down to check pause/resume.
3. Type a newer draft before acknowledgement, steer during the fixture run, and Stop. Confirm exact queue text is recoverable.
4. Copy a code block and open the demo's README link in an already running VS Code window; verify line navigation and no duplicate open.
5. Open model/thinking dialogs. Verify keyboard selection, Escape/cancel, focus, and normal Cmd+C/Cmd+V editing.
   Also use Settings → Appearance to switch Nimrod ↔ Dracula, import a standalone VS Code JSON/JSONC theme through the native file chooser, cancel another import, relaunch to check persistence, and remove only the local imported copy. Confirm live cards/drafts/scroll are retained during theme changes.
6. Confirm the Project bar has no Open project, palette or Disconnect buttons. Use native **File → Open project…** / **⌘/Ctrl O** to select a directory; cancellation must do nothing and opening an existing project must focus it without starting Pi. Confirm the Restart icon stays disabled for offline/temporary and not-yet-saved sessions. Close a demo, start another, and ensure no old events/drafts are submitted. With an intentionally used saved session, restart it and verify exact history/draft retention, confirmation during active work, sibling isolation and no prompt replay. Close the window and quit; confirm its owned processes exit.
7. Choose **New session** when intentionally ready for live work. Confirm **Pi · awaiting first save**, then **Pi** after an actual assistant message is persisted; hover for the exact path. Verify scoped models/extensions; a prompt is real provider work. Once idle, reopen the built app and explicitly choose **Resume last session**. Confirm the same file/project/history and its unsent draft; no prompt should be submitted on launch. Also exercise the native **Resume session file…** picker, cancel, wrong-project/missing-file failures, and explicit temporary/demo isolation. These persistence launch/picker flows still need native acceptance; automated checks did not open or interrupt the user's window.

## Known PoC limitations

- No automatic Pi resume or process continuity across quit. Session tree deletion requires the installed extension's verified GUI bridge; external writers are not coordinated. Resume restores active-context history, not every tree branch or pre-compaction entry.
- Catalog discovery reads Pi's default encoded workspace directory or session-directory environment override. Arbitrary custom locations and differently encoded symlink-directory aliases require exact-file open. Workspace preference changes are not live-synchronized across already-open windows.
- New sessions are not resumable until Pi writes a file; a rename alone does not flush an empty Pi 0.86.1 session. Existing temporary conversations are not retroactively saved.
- Scoped draft libraries (including their embedded last-session pointers) still use browser storage; the separate global last-session pointer now lives in app-managed state. Failures are surfaced, not a durable-draft guarantee. Unassigned/legacy recovery sources are retained. External writers/file mutation are not excluded by Nimrod's process slot or read-only validation.
- Kill-on-drop is not cleanup after arbitrary OS-level parent death. Detached descendants are not tracked or guaranteed terminated.
- Open file links, not automatic linking of all path-looking text. File targets must exist. Only VS Code handoff is implemented.
- Windows Pi npm `.cmd` wrappers need a JS entry-point selection; editor launching and packaging still need Windows acceptance.
- No signing/notarization or installer/update pipeline. The macOS packaging task is intentionally platform-specific for this first milestone.
