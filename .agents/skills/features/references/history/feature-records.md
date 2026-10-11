# Feature execution and investigation records

Historical evidence extracted during documentation cleanup. **Not current specifications or acceptance instructions.** Counts, worktree paths and older behavior may be superseded. Use [current verification status](../verification.md) and the [feature index](../../SKILL.md). The earlier chronological log is preserved in [verification history](verification.md).

## build-cache

## Verification

On macOS, installed the pinned Aqua binary through mise. Offline fixtures used two
separate Cargo roots (`main` and `.worktrees/branch`), separate targets, and one
shared dependency source directory, modeling Cargo's shared registry source cache.
Main-first compilation produced a dependency miss; branch compilation produced a
Rust cache hit. After editing only the fixture dependency, branch-first compilation
produced a miss and main compilation produced a hit. The second sequence also
verified disk cache use after restarting the server started by this task; no
pre-existing sccache executable/server was found before setup.

The fixture created no model/Pi calls or application windows and did not modify
main's artifacts. `CARGO_NET_OFFLINE=true mise run check` passed 341 TS/Node tests, formatting,
Clippy and 76 Rust tests (two opt-in real-Pi tests ignored).
`CARGO_NET_OFFLINE=true mise run build` passed packaging and macOS signature
verification for `.worktrees/shared-build-cache/src-tauri/target/release/bundle/macos/Nimrod.app`.
Both used the task worktree only; main's default/running bundle was untouched.
After merging into main, verified `mise exec -- printenv RUSTC_WRAPPER
CARGO_INCREMENTAL` and `mise exec -- sccache --version` in main and every existing
worktree (card-plugin-plan, keybinding-option-key, native-session-deletion,
resume-session-picker, session-terminology, shared-build-cache, sidebar-filters).
All resolved `sccache`, `0` and version 0.18.0. Existing in-progress worktree edits
were preserved; no child overrides, branch merges or app launches were needed.
Linux and Windows cache behavior and native application acceptance are unverified.


## card-plugins

No separate executed acceptance record; consult the historical verification log and current feature test map.

## command-interactions

- `test/command-palette.test.ts`: all current page kinds and a future-feature selection, direct/palette entry, keyboard/native/API dismissal, pending-choice cancellation, deferred native close, stale metadata, explicit Back/query retention, accepted action after focus restoration, IME/repeated Enter and refresh/error paths.
- `test/shell.test.ts`: direct session/model/thinking shortcuts and status controls now assert one-Escape closure, with drafts, session lifecycle and prompt-free behavior retained; Pi dialog priority is unchanged.
- `test/browser/preferences.spec.ts`: both picker bullet markers, blank-slot label alignment and separator-relative size, independent keyboard/hover highlights, and acknowledged effort changes without submitting the draft. On `fix/picker-selection-bullet`, `mise run check`, all 36 offline WebKit tests and the signed macOS worktree build pass; native visual acceptance and Linux/Windows verification remain pending.
- `test/browser/keybindings.spec.ts`: direct shortcuts dismiss in one press and retain composer focus/draft.
- `test/browser/workspace-tabs.spec.ts`: offline streaming continues under the palette; explicit Back retains the command query and one Escape from Resume restores the untouched composer. Naming cancellation retains the live session.

Verification on `fix/palette-dismissal`: `mise run check` passes 358 TypeScript/Node tests, formatting/Clippy and 93 default Rust tests (two opt-in Pi smokes ignored); all 33 offline WebKit tests and the signed macOS worktree build pass. See [verification](verification.md#one-step-command-interaction-dismissal).

## command-ranking

Verified on `feat/command-palette-ranking`: `mise run check` passes 372 JS tests and 96 Rust tests (two opt-in Pi smokes ignored); `mise run build` passes with verified ad-hoc macOS bundle signature; all 38 offline WebKit tests pass. An initial check hit the existing single-instance timeout fixture's `Option::unwrap()` race; subsequent full runs passed without modifying it.

## composer

`test/steering-transcript.test.ts` covers FIFO duplicates, historical exclusions, event-before-receipt, authoritative queue/dequeue/recovery and disconnect labels. `test/native-view.test.ts` covers immediate safe-Markdown previews, in-place reconciliation, acknowledgement/newer drafts, coalesced clear/recovery, failures/reset and follow-up/slash exclusions. `test/browser/steering-transcript.spec.ts` uses only the offline demo in automated WebKit to verify stable user articles, no duplicate/status text and preserved bottom follow/older-history reading. Validation in `.worktrees/transcript-steering`: offline `mise run check` passed 387 TS/Node tests, formatting, Clippy and 97 Rust tests (two real-Pi tests intentionally ignored); `mise run build` passed macOS app packaging/signature verification; the full `npm run test:browser` suite passed 43 automated WebKit tests. One repeat check during parallel build/browser validation hit the unchanged Rust `single_instance::tests::lock_holder_without_listener_times_out_without_becoming_primary` fixture's `Option::unwrap()`; a subsequent standalone full check passed all 97 Rust tests. Native Pi/macOS and Linux acceptance remain unverified; no user app was launched.

## image-paste

Validation in `.worktrees/paste-images`: `mise run check` passed 445 TS/Node tests, formatting/Clippy and 108 Rust tests (two real-Pi smoke tests intentionally ignored); `mise run build` passed macOS app packaging/signature verification; `npm run test:browser` passed all 56 offline WebKit tests. No user app was launched. Native macOS/Linux clipboard and real Pi image acceptance remain unverified.

## keybindings

Palette-cleanup coverage: shell tests assert shortcuts on every visible command, removed `demo`/`file` controls/actions and inert old overrides; Cmd-R tests retain mounted draft/file identity and modal/repeat/IME/eligibility guards, plus rebinding/unbinding. WebKit checks command shortcut coverage, removed rows/controls, temporary Restart no-op and direct keybinding-search focus. Full cleanup verification: 397 TS/Node tests, 97 Rust tests (two opt-in Pi smokes ignored), formatting/Clippy, all 43 offline WebKit tests and signed macOS build passed. Native Cmd-R delivery/menu interception and Linux/possible Windows acceptance remain unverified.

Latest Option-key fix verification (worktree `keybinding-option-key`, branch `fix/option-keybindings`): 341 TS/Node tests, 76 default Rust tests (two opt-in real-Pi smokes ignored), formatting/Clippy, all three targeted keybinding WebKit tests and signed macOS build pass. The complete browser suite was not rerun for this matcher/recorder-only fix. Artifact: `.worktrees/keybinding-option-key/src-tauri/target/release/bundle/macos/Nimrod.app`. Injected WebKit keyboard events are regression evidence, not native layout acceptance. No running app/default bundle modification or user-session/model request occurred.

## modal-layout

No separate executed acceptance record; consult the historical verification log and current feature test map.

## model-thinking

- `test/model-thinking-controller.test.ts`: changes while busy/compacting, work beginning during a picker/lookup, startup and concurrent-operation guards, disconnect and capability races, failed mutation without optimistic display.
- `test/native-view.test.ts`: status controls remain enabled during working/compacting snapshots, route picker actions without sending/stopping work, preserve drafts, and disable for readiness/changing/unavailability.
- Verified on `fix/live-model-preferences`: `mise run check` passes 399 TypeScript/Node tests, Rust formatting/Clippy and 97 Rust tests (two opt-in Pi smokes ignored). `mise run build` produces the signed macOS bundle and passes signature verification.
- Fixture tests do not establish native acceptance; manually changing selections during a real run and Linux/Windows verification remain pending. No paid requests or live compaction for automated validation.


## notifications

Local routing verification after integration with main: `mise run check` passed (355 TypeScript/UI tests; 93 Rust tests, 2 opt-in Pi tests ignored), `npm run test:browser` passed all 33 WebKit tests, and `mise run build` produced a signature-verified macOS bundle. No real OS notification click, Linux compilation or native Linux delivery/focus test was performed.

#### macOS 27 investigation

Read-only `sw_vers` confirms macOS 27.0.1 (26A434). Apple's [macOS 27 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes) list a Notification Center dismissal fix, not a foreground-banner policy change; no UserNotifications-specific replacement policy was found. The installed macOS SDK still exposes the same `willPresentNotification` selector and Banner/List options (available since macOS 11). [Apple's current delegate docs](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate) explicitly require installing the delegate before launch finishes and warn late installation can miss notifications. The running earlier signed build installed on first notification; the staged diagnostic build moves this to startup. This is a concrete lifecycle suspect, not proof of a macOS 27 regression or a verified foreground fix. Use actual callback counts/API policy from the new process before attributing suppression to the OS. Existing tests/registration timings are not evidence the new code took effect without restart.

Native follow-up on the diagnostic build: the immediate post-submit snapshot showed 0 calls, but an explicit later refresh showed 2; this was callback timing, not evidence of a missing delegate. Passive logs for the test show successful entitlement checks, DND `interruptionSuppression: none` / `resolutionReason: disabled`, `Presentation reply dev.nimrod.desktop ["list", "banner"]`, and usernoted `Presenting ... as banner`. NotificationCenter then queues `present` and stores the record, with no desktop banner observed by the user. Thus the OS actually receives the requested flags; do not blame delegate registration or block ABI solely from the initial zero. A separate inert Swift `UNMutableNotificationContent()` probe on this Mac reports interruption level 1, matching Active; it never initializes a notification center, requests permission or posts anything. The remaining fault is unverified desktop presentation/policy after the banner decision; no macOS 27 rule change or UI regression is yet established. `canDisplayWhileCenterIsClosed: false` appears on the stored list-item log, but its private semantics alone are not proof of a causal blocker. The user then performed the Persistent-versus-Temporary A/B test: changing only style to Persistent made foreground test alerts visible. This establishes a working signed/native foreground path under Persistent and narrows the remaining inconsistency to Temporary presentation or its cached policy on this macOS 27.0.1 setup. It does not establish an intentional OS rule change, every Mac being affected, or that native registration alone caused the earlier failure. No production flag/priority workaround, time-sensitive/critical entitlement, sound, permission reset or automatic OS-style override was applied. Keep native style user-controlled and document Persistent as the currently user-accepted workaround; switching back to Temporary is an optional cache-versus-reproducibility check, not a prerequisite for using working alerts.

#### Whole-bundle signing correction

The user's explicit Settings test returned `UNErrorDomain / 1` (Apple's `UNErrorCodeNotificationsNotAllowed`). Inspection of the previous packaged app showed `Identifier=nimrod-<linker hash>` instead of `dev.nimrod.desktop`, `flags=... (adhoc,linker-signed)`, `Info.plist=not bound`, no sealed resources and failed `codesign --verify --strict`. This is not a valid signed application bundle. UserNotifications requires application signing; a macOS settings entry does not establish that a newly built executable's code identity is allowed. [Electron's migration note](https://electronjs.org/blog/electron-42-0) independently documents the same UserNotifications signing requirement.

The configuration now sets `bundle.macOS.signingIdentity` to `-` for whole-bundle local ad-hoc signing. `mise run build` runs `npm run verify:bundle` after Tauri packaging: verify strict code validity, reject linker-signed flags, require signing identifier to match configured bundle identifier, and require bound Info.plist/sealed resources. It uses `CARGO_TARGET_DIR` when present, or an explicit app argument, and skips the macOS check on other host platforms. It only reads the artifact; no launch/notification/permission mutation occurs. Test fixtures exercise full ad-hoc/certificate signatures versus wrong identity, linker-only and unsealed metadata.

No certificate is created/imported and no Keychain/TCC/OS notification settings are changed. This is local ad-hoc signing, not Developer ID/notarization, and its implicit designated requirement can change with a rebuild; do not promise grants survive rebuilds. A stable certificate is a separate, user-authorized future step. Never repair a running user's bundle in place: stage a separate artifact for signing/acceptance. Corrected native errors now identify the failing authorization/submission phase. The user subsequently confirmed that the signed build's explicit test notifications reach Notification Center without errors, but desktop banners still do not appear. Passive native logs show two accepted requests with hasError=0; existing logs do not establish whether our foreground delegate ran or reveal alertStyle/Focus policy. The SDK confirms Banner | List support on macOS 11+ and the implemented selector signature. The user then explicitly confirmed Temporary style, Desktop/Notification Center/Lock Screen checked and Focus off. One subsequent completion displayed a banner without restarting (therefore not caused by the unlaunched diagnostics/startup edits), followed by another foreground completion that reached Notification Center without a banner; the foreground failure remains unresolved/intermittent. Startup installation and read-only API/callback diagnostics were added to distinguish platform policy from an uncalled handler rather than repeat permission resets. Do not treat enabled delivery/Notification Center as proof of enabled banners. Signature verification by itself remains distinct from delivery acceptance.

Follow-up passive native logs showed the signed artifact opened, ran for roughly 22 seconds with its own WebKit processes, then exited; the default artifact opened afterward and its process produced the later authorization failure. The reported unphased `macOS notifications:` error also belongs to the older binary, whereas the staged signed build reports `macOS notification authorization:` / `submission:`. Do not attribute this sequence to single-instance forwarding without evidence, or treat it as a delivery test of the signed build. The shared project error area persists across session selection and does not imply every Pi session failed. The normal launcher still targets the default artifact; wait for explicit user quit/approval before publishing the verified copy there, never patch a running bundle in place.

Unbundled development executables now report an explicit packaged-app requirement instead of using Terminal's identity. Packaged macOS native acceptance remains user-owned; compilation and mocked commands do not establish receipt. Linux needs a desktop service; Windows needs installed application identity. No platform parity, permissions, DND, sound or activation acceptance is established by unit tests/build. Root-directory projects use a generic Project label when no final path component exists.



## pop-outs

Native-cycle change evidence in `.worktrees/popout-window-cycle`, branch
`fix/popout-window-cycle`: 347 TS tests, 80 default Rust tests (two opt-in real-Pi
smokes ignored), packaged macOS build and bundle-signature verification. Three new
regressions cover flag preservation/conflicts, idempotence and hidden creation setup.
These are flag/source-boundary tests, not native window-cycling acceptance. Targets
and the app bundle are worktree-local; the primary checkout's bundle is untouched.
Fourteen offline WebKit tests passed for the earlier content-first UI; they were not
rerun for the later native-only focus/project-visibility changes.
See [verification](../verification.md) for the latest recorded evidence.

## projects-and-sessions

- `session_catalog.rs` returns optional `parentSession` metadata from Pi's header; `sessions.rs` carries the same metadata through exact-file inspection/startup. Missing/null parent means root; a nonempty string means child. Malformed parent metadata is reported, not treated as a root.
- `paletteSessions` filters children after overlaying open-session titles. Pi's subagent extension uses `parentSession`, as do saved forks/branches: the picker intentionally lists roots, not all user-created branches. Do not infer child status from names, prompts, filenames, notifications or agent tool calls in a parent's history. Children written without parent metadata cannot be reliably distinguished.
- Open exact-file entries outside the catalog are inspected read-only before inclusion, so an open child cannot leak back into Resume through sidebar merging. Failed inspection retains the sidebar entry/draft and contributes a picker warning; it does not launch Pi. Such entries have no catalog mtime and sort after catalog history. Their row time comes from the open entry's recency, not inspection/resume time.
- `SessionRowPresentation.open` carries sidebar path membership only, not `presented`, transport, child ownership or the current sidebar filter. It adds Open to search and the accessible name without a visible badge. Closed rows carry the distinct dash indicator; open rows reuse sidebar activity (including inactive circles). `src/picker-hints.ts::createPickerEnterHint(document)` owns the single Enter SVG definition for Resume, Switch, Delete sessions, recent projects and theme previews. `.picker-enter-hint` in `src/workspace.css` owns its shared 16px dimensions, non-shrinking slot and muted color; palette-specific rules own right alignment and selected-only visibility, so selection does not change truncation. New picker surfaces should reuse this factory/class rather than copy paths or styles. Confirmation action buttons remain plain labels, and model/thinking pickers retain their existing no-icon presentation. `test/picker-hints.test.ts` covers owning-document and decorative/non-focusable semantics. It is aria-hidden/non-focusable, never a separate button. Previews and file paths are search-only.
- Choosing an open entry goes through the existing `openSession`/activation path: reuse its mounted entry and connected process, or explicitly resume an inactive entry. Switch remains all open entries (including child and temporary sessions). Closed children have no product opening entry point. No duplicate entry/process or prompt replay.
- Fixture coverage: `test/command-palette.test.ts` checks membership/search/activation and Enter hint structure/keyboard selection; `test/shell.test.ts` checks connected/inactive/disconnected membership, filtered rows, Close, root/child filtering, out-of-catalog open children and unchanged Switch/reuse behavior. Rust catalog fixtures cover absent/null/valid/malformed lineage and child exact-file inspection. Offline WebKit also compares Resume/Switch geometry and timestamp typography, verifies long-title truncation and search-only previews. Verified for the indicator/Enter-hint change: `mise run check` (395 JS tests; 97 Rust tests, 2 ignored), `mise run build` including macOS bundle-signature verification, and the targeted offline WebKit workspace/project suites (18 tests). The WebKit fixtures also verify selected-only Enter visibility and unchanged title/time geometry during keyboard selection. Title-line Enter alignment and shared picker-hint extraction (`fix/picker-enter-icon`): `mise run check`, signed `mise run build` and 20 targeted offline WebKit tests (picker Enter geometry, theme preview, projects and workspace sessions) passed. Clipping follow-up (`fix/picker-hint-rendering`): offline WebKit screenshots reproduced the truncated SVG before the border-box/padding fix and showed the full matching icon afterward. `mise run check`, signed `mise run build` and 22 targeted WebKit tests passed, including wide/narrow clipping checks at 100%, 125% and 150% CSS zoom (fixture native zoom remains mocked). Native indicator/icon layout/picker acceptance remains user validation, not a fixture guarantee; Linux/Windows were not tested.

Latest combined-checkout evidence: 238 TypeScript/Node tests, 47 default Rust tests (two opt-in real-Pi smokes ignored), formatting/Clippy, packaged macOS build and 14 offline WebKit tests passed. An earlier WebKit rerun caught a mixed intermediate notification edit (`preferences.notificationsEnabled` missing); after those concurrent edits landed, the complete rerun passed. No notification implementation changes were made for restart. Native saved-session restart/menu/focus acceptance remains unperformed.


## session-deletion

No separate executed acceptance record; consult the historical verification log and current feature test map.

## session-navigation

Shared navigation verification (`.worktrees/session-navigation`, branch `refactor/session-navigation`): `mise run check` passes 366 TS/Node tests, formatting/Clippy and 93 Rust tests (two opt-in Pi smokes ignored); the signed macOS build verifies and all 37 offline WebKit tests pass. The first full check hit the existing single-instance lock-holder timeout fixture's `Option::unwrap()` failure; its focused retry and complete check rerun passed without any Rust change. The new WebKit invariant compares All/Switch and both wrapped traversal directions through creation and acknowledged-message recency. No primary bundle/user app, live Pi/models, real session deletion, upstream extension, commit or push was touched. Native focus/shortcut and Linux/possible Windows acceptance remain separate.

## settings-layout

No separate executed acceptance record; consult the historical verification log and current feature test map.

## sidebar-attention

Session-cycle ordering fix (`.worktrees/session-cycle-order`, branch `fix/session-cycle-order`): the regression fails against the old open-order implementation; `mise run check` passes 361 TS/Node tests and 93 Rust tests (two opt-in Pi smokes ignored), formatting/Clippy; `mise run build` verifies the signed macOS bundle; all 36 offline WebKit tests pass. Both cycling directions wrap in All's current recency order, including after acknowledged sends, with collapsed/filtered navigation and unchanged recency. No user app/window, main bundle, live Pi/models or upstream extension was touched. Native shortcut/focus and Linux acceptance remain user/platform validation.

Counted-filter verification in `.worktrees/sidebar-filters`: `mise run check` passes 345 TypeScript/Node tests, formatting/Clippy and 76 default Rust tests (two opt-in Pi smokes ignored); the signed worktree build and all 31 offline WebKit tests pass. Native visual/focus and Linux/possible Windows acceptance remain separate. No user app/window, sessions, Pi/models, OS notifications or upstream extension were touched.

Latest historical-recency/time-label verification (isolated worktree at `26e551e`): `mise run check` passed 338 TypeScript/Node tests, formatting/Clippy and 76 default Rust tests (two opt-in Pi smokes ignored); `mise run build` packaged/verified the worktree macOS app and all 28 offline WebKit tests passed. No main-checkout bundle change, manual app testing, real user-session deletion or live Pi/model request. Native/platform acceptance remains separate.

Integration verification after rebasing onto `f149f66` in `.worktrees/sidebar-recency-time`: check passed 340 TypeScript/Node tests and 76 default Rust tests (two opt-in smokes ignored), formatting/Clippy, signed worktree build, and all 29 offline WebKit tests. Moving the worktree invalidated cached absolute Tauri permission paths; rebuilding only its generated Cargo target fixed this. No main bundle, user app/session, global cache or unrelated worktree changes.

Earlier prompt-only recency/rename-exclusion verification: `mise run check` passed 294 TypeScript/Node tests, formatting/Clippy and 70 default Rust tests (two opt-in Pi smokes ignored); the macOS build/signature verification and all 20 offline WebKit tests passed. These are combined-checkout totals, with no Rust, Pi or installed-extension edits for this correction. Browser output was isolated under `/tmp`. Native visual/scroll/focus and Linux/Windows acceptance remain unperformed.

Latest blank-surface verification: `mise run check` passed 279 TypeScript/Node tests, formatting/Clippy and 69 default Rust tests (two opt-in Pi smokes ignored); the packaged macOS build and 18 offline WebKit tests passed. An intermediate check encountered concurrent Rust formatting edits; the final rerun passed. No Rust changes were made for the blank-surface feature.

## sidebar-resize

Latest verification: `mise run check` passed 312 TypeScript/Node tests, formatting/Clippy and 71 default Rust tests (two opt-in Pi smokes ignored); `mise run build` packaged and verified the macOS bundle; all 23 offline WebKit tests passed. Native visual/pointer/zoom acceptance remains outstanding.

## single-instance

No separate executed acceptance record; consult the historical verification log and current feature test map.

## syntax-highlighting

Run `mise run check` and offline `npm run test:browser`. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](../build-cache.md#explicit-build-and-publication-workflow).
Current user-only inference revision on `fix/syntax-highlighting` passes full
`mise run check` (97 Rust tests, two opt-in tests ignored, plus the TypeScript
suite), `mise run build` with macOS signature verification, and all 50 offline
WebKit tests.

## themes

### Open VSX verification

On `feature/open-vsx-themes`, tool formatting/Clippy and 7 offline Rust tests
passed (6 library, 1 CLI integration). `mise run check` passed 436 TS/Node tests,
formatting/Clippy and 108 app Rust tests (2 opt-in live-Pi smokes ignored). Explicit
registry discovery/collection succeeded; cache-only regeneration is byte-identical.
Signed `mise run build` passed; artifact:
`.worktrees/open-vsx-themes/src-tauri/target/release/bundle/macos/Nimrod.app`.
The first full WebKit run passed 51 tests and exposed a test-only adjacency
assumption in the theme test (new duplicate variants); corrected test passes
in isolation and the final full suite passed all 52 tests. No live app
launch/quit or user model/session requests.

At the user's explicit request, installed the verified 267-variant app at the
primary checkout's `src-tauri/target/release/bundle/macos/Nimrod.app`, used by the
installed `~/.local/bin/nimrod` symlink. Previous eight-theme bundle retained at
`src-tauri/target/release/bundle/macos/.previous-app.4ljWdM/Nimrod.app`. Verified
installed signature and executable equality with the worktree build. No CLI
configuration or primary tracked source changes. User must fully quit/relaunch
the running older app; installation did not launch or quit any window.

### Previous bundled-source verification

On `feature/bundled-vscode-themes`, `mise run check` passed 436 TS/Node tests,
formatting/Clippy and 108 Rust tests (2 opt-in live-Pi smokes ignored). All 52
offline WebKit tests passed. `mise run themes-check` passed formatting/Clippy,
4 library tests and the offline CLI integration test. Initial explicit collection
succeeded; offline regeneration is byte-identical for catalog and notices.
`mise run build` passed and verified the macOS bundle signature. Build artifact:
`.worktrees/bundled-vscode-themes/src-tauri/target/release/bundle/macos/Nimrod.app`.
No app launch/quit or live sessions/model requests. At the user's subsequent
explicit request, installed the verified app at the primary checkout's
`src-tauri/target/release/bundle/macos/Nimrod.app`, used by `~/.local/bin/nimrod`.
Retained the previous Gogh app at
`src-tauri/target/release/bundle/macos/.previous-app.glAQyH/Nimrod.app`; verified
installed signature and executable equality. No CLI config/primary tracked source
changes. Quit/relaunch is user-controlled.
Native visual acceptance and Linux/possible Windows verification remain pending.

## Development history

Prior Gogh implementation lives uncommitted in `.worktrees/gogh-theme-picker` and
was copied as this feature's starting point without committing or discarding it.
That earlier build was installed at the primary CLI path with user permission;
previous bundle retained at `.previous-app.Y5j43z/Nimrod.app`. This worktree's build
subsequently replaced that CLI bundle on explicit request (see verification above),
without launching/quitting the user's app.
Native palette visual/focus acceptance on macOS and Linux remains user validation;
possible Windows support is not verified parity.


## transcript-cards

Call-ID identity change: `mise run check` and `mise run build` passed on the macOS development host; the packaged app signature was verified. All 20 offline WebKit regressions passed after installing the required Playwright WebKit revision. These do not establish packaged-app visual or Linux/Windows acceptance; user validation remains required.
