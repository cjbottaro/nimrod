# Transcript layout, scrolling and focus

**Status: implemented.** User guide: [Reading conversations](../../../../docs/reading-conversations.md). Related: [cards](transcript-cards.md), [composer](composer.md), [navigation](session-navigation.md), [notifications](notifications.md).

## Specification and acceptance criteria

The transcript is its own scroll pane above the in-flow Status area/composer. Transcript, status content, submission notices and composer use fluid width with 20 CSS-pixel side gutters, not inherited 920/960px caps. Status background/separators remain full-width; launch forms/modals retain independent compact sizing.

Preserve live follow versus older-history reading through incremental updates, card/content resizing, composer growth, native zoom and hidden-session switching. Routine snapshots never steal focus or rebuild connected disclosure/spinner nodes. Each mounted session owns geometry, nodes and draft selection. Session notices occupy a bounded in-flow row above and outside the transcript pane, aligned with its gutters; application notices reserve shell space separately. Notice appearance/disclosure uses existing resize/follow ownership, never forced bottom navigation. See [error presentation](error-presentation.md).

## Code map

- `src/pi/transcript-scroll.ts`: sole deferred transcript-follow owner; capture/request/flush, reader cancellation, resize recovery and active suspension.
- `src/pi/webview-client.ts`: mounted renderer, snapshot/paint ordering, explicit reset, viewport observers and bottom-navigation bridge.
- `src/pi/tool-card.ts`: independently scrolling per-card output; disclosure state.
- `src/main.ts`: presented-session activation, modality, native zoom requests and notification navigation.
- `src/pi/transcript.css`, `src/theme.css`, `src/workspace.css`: fluid surfaces, overflow and focus/layout styling.

## Scroll invariants

- Capture follow intent before mutation and request deferred follow through the same owner. Native/fixture layout growth is not user intent.
- Explicit upward wheel/touch/key input and meaningful upward scrollbar movement cancel follow. Horizontal code scrolling must not cancel transcript following merely for a smaller vertical delta.
- Near-bottom threshold is 80 CSS pixels. Fractional WebKit settlement of at most 2px when recorded positions represent bottom must not cancel pending follow or latch interruption. During pending growth, compare against prior bottom as well.
- Resize uses previously settled geometry; don't combine new viewport dimensions with old offsets. Bottom clamping after collapse is layout, not upward navigation.
- Hidden views suspend transcript painting as well as scroll bookkeeping, retaining the latest presentation snapshot, follow intent, reader offset and independent tool inspection. Ordered state/queue/receipt processing and background attention/notices remain live. Hide cancels/guards queued paint and output-restoration callbacks. Reveal the root, synchronously catch up while scroll intent is suspended, then reactivate scroll/disclosure/composer sizing before shell focus restoration; do not interpret zero hidden dimensions or catch-up growth as navigation. Reset/disposal remain immediate, distinct boundaries.
- Per-tool output inspection is independent from transcript follow and other tool outputs.
- Queued follow-up turns share one bottom-sticky transcript stack, with bounded independent overflow, no separator/extra gap and ordinary user-turn styling/spacing. They stay visible during older-history reading without enabling auto-follow. Steering/Queued text shimmer never changes layout; reduced-motion labels are static and inactive/hidden presentation pauses it. Stack additions, streaming growth, consumption/error unpinning and recovery use the same capture/request path; never force-scroll or rebuild the adopted user article. [Composer](composer.md#pending-user-turns-in-the-transcript) owns delivery lifecycle.
- Only an explicit bottom-navigation action (currently valid notification click) overrides reading position/re-enables follow. Ordinary switching preserves it.

## Focus, reset and zoom

Routine state/history refresh never focuses the composer. Explicit launch focuses once only when its session is still selected and no modal owns focus. Mounted view switching uses unique IDs and stable `data-pi-id` hooks; never reuse one renderer across sessions.

Explicit resume/restart resets session-local disclosure/composer presentation through the established boundary, without resetting siblings or replaying prompts. Settings uses HTML modality over unchanged underlying layout and restores prior focus; startup cannot focus through it.

Whole-app native webview page zoom is 75–200%, default 125%; reset is 100%. Never use font-size or CSS transforms as replacement. Requests serialize and only successful changes persist. Zoom doesn't refocus, mutate drafts or change harness state; resize/follow owns resulting geometry. [Keybindings](keybindings.md) owns dispatch/modal policy.

## Native link navigation

- `src-tauri/src/webview_navigation.rs` owns the native navigation/new-window backstop, installed by every welcome/project creation path in `workspace_windows.rs` and the shared new/restored pop-out helper in `popouts.rs`.
- Ordinary transcript/plugin/pop-out clicks retain their validated native link handlers. WebKit's context-menu **Open Link / Open URL** bypasses DOM click handlers; native navigation callbacks must cancel HTTP(S) navigation and hand the URL to the OS default browser asynchronously. New-window requests use the same handoff and always deny creation of an embedded browsing window.
- Allow only the local app entry document (root/index.html, query and fragment variants) at the exact Tauri app origin; development additionally allows the configured dev-server origin. Production never trusts the configured development HTTP origin. Same-origin non-document resources and unsupported schemes are blocked, not loaded or passed to the browser. Existing file-link/editor handling remains frontend-owned; a native file-navigation attempt is blocked.
- Cancel before browser handoff completes; an opener failure never falls back to in-webview navigation. `nimrod-link-error` targets only the originating webview; shell/pop-out listeners route it to the shared notice strip without retries, focus changes, session navigation or Pi work.
- No app-level Cmd+` interception or change to native cycling eligibility. The user reported cycling failure after replacing a project webview via its link context menu, closing it and reopening the project; the cycling cause remains unconfirmed. Native acceptance should exercise context-menu link opening in project/new/restored reference windows, then close/reopen and normal project-window cycling. Do not infer a cycling fix from navigation-policy fixtures.

## Tests and remaining acceptance

New hidden-paint coverage in `test/native-view.test.ts`, `test/shell.test.ts`, `test/tool-disclosure.test.ts` and `test/browser/hidden-session-painting.spec.ts` targets zero hidden paints, synchronous catch-up, raced callbacks, ordered queue transitions, retained cards/plugins, paused disclosure timers and reader/follow/output inspection. These additions have not been run; packaged reveal latency/responsiveness and platform behavior remain unverified.

`test/transcript-scroll.test.ts`, `test/native-view.test.ts`, tool/disclosure tests and offline WebKit workspace/steering/sidebar/settings/notification regressions cover rounding, pause/resume, identity, hidden geometry, focus and independent reading positions. The historical rounding reproducer is preserved in [verification history](history/verification.md#fractional-zoom-auto-follow-regression).

Rust `webview_navigation::tests` covers app entry/reload/query/fragment URLs, exact development origins, HTTP(S) navigation and new-window cancellation with a fixture opener, unsupported schemes/resources, and guard coverage of every window-creation path. `test/shell.test.ts` verifies originating-window-only browser failure notices in project/reference routes without navigation, retry or Pi launch. These do not exercise WebKit's actual context menu or the OS browser opener; macOS native acceptance and Linux/possible Windows verification remain pending.

When validation of scrolling changes is explicitly requested, use `mise run check` and `npm run test:browser`; do not run tests/checks automatically. Fixtures use CSS zoom/mock native IPC, not native Tauri page zoom. Native trackpad/keyboard, 5K/multi-display geometry, animation timing and Linux/possible Windows webviews require user/platform acceptance.
