# Transcript layout, scrolling and focus

**Status: implemented.** User guide: [Reading conversations](../../../../docs/reading-conversations.md). Related: [cards](transcript-cards.md), [composer](composer.md), [navigation](session-navigation.md), [notifications](notifications.md).

## Specification and acceptance criteria

The transcript is its own scroll pane above the in-flow Status area/composer. Transcript, status content, submission notices and composer use fluid width with 20 CSS-pixel side gutters, not inherited 920/960px caps. Status background/separators remain full-width; launch forms/modals retain independent compact sizing.

Preserve live follow versus older-history reading through incremental updates, card/content resizing, composer growth, native zoom and hidden-session switching. Routine snapshots never steal focus or rebuild connected disclosure/spinner nodes. Each mounted session owns geometry, nodes and draft selection. Session notices occupy a bounded in-flow row above and outside the transcript pane, aligned with its gutters; application notices reserve shell space separately. Notice appearance/disclosure uses existing resize/follow ownership, never forced bottom navigation. See [error presentation](error-presentation.md).

## ACP POC reuse

`src/conversation-view.ts` owns the shared mounted engine; Pi's former entry delegates through its projection/policy. There is no backend-mode flag or second scroll/follow engine. [Harness presentation](harness-presentation.md) owns the contribution boundary and rationale. ACP feeds display snapshots and optional continuous dirty-row revisions directly, not Pi events. Structural changes/gaps use the same full fallback, hidden catch-up and disposal boundaries. Inline ACP permission regions live in their owning interaction area, never a background global modal; their layout changes use the existing viewport resize owner. `test/browser/acp-sessions.spec.ts` supplies mixed-backend disclosure/reader/draft coverage. Full offline validation covers the extraction and permission/mode-control changes; it does not establish native app acceptance. See [ACP POC](acp-harnesses.md).

## Code map

- `src/pi/transcript-scroll.ts`: sole deferred transcript-follow owner; capture/request/flush, reader cancellation, resize recovery and active suspension.
- `src/conversation-view.ts`: mounted renderer, snapshot/paint ordering, explicit reset, viewport observers and bottom-navigation bridge. `src/pi/webview-client.ts` is the Pi compatibility entry.
- `src/pi/tool-card.ts`: independently scrolling per-card output; disclosure state.
- `src/main.ts`: presented-session activation, modality, native zoom requests and notification navigation.
- `src/pi/transcript.css`, `src/theme.css`, `src/workspace.css`: fluid surfaces, overflow and focus/layout styling.

## Scroll invariants

- Capture follow intent before mutation and request deferred follow through the same owner. Native/fixture layout growth is not user intent.
- Explicit upward wheel/touch/key input and meaningful upward scrollbar movement cancel follow. Horizontal code scrolling must not cancel transcript following merely for a smaller vertical delta.
- Near-bottom threshold is 80 CSS pixels. Fractional WebKit settlement of at most 2px when recorded positions represent bottom must not cancel pending follow or latch interruption. During pending growth, compare against prior bottom as well.
- Resize uses previously settled geometry; don't combine new viewport dimensions with old offsets. Bottom clamping after collapse is layout, not upward navigation.
- Hidden views suspend transcript painting as well as scroll bookkeeping, retaining the latest presentation snapshot, follow intent, reader offset and independent tool inspection. Ordered state/queue/receipt processing and background attention/notices remain live. Hide cancels/guards queued paint and output-restoration callbacks. Reveal the root, synchronously catch up while scroll intent is suspended, then reactivate scroll/disclosure/composer sizing before shell focus restoration; do not interpret zero hidden dimensions or catch-up growth as navigation. Reset/disposal remain immediate, distinct boundaries.
- Per-tool output inspection is independent from transcript follow and other tool outputs. Streaming paints capture only affected card viewports before mutations and use one guarded deferred batch for affected live outputs, not registry-wide per-card callbacks. `DomCardController` retains synchronous per-key output restoration for affected cards, including completion/multiple custom viewports. Hide/reveal deliberately captures/restores all suspended inspection positions; full structural reconciliation owns registry pruning. See [affected-output work](../../performance-optimizations/references/tool-output-scroll-work.md).
- Steering and queued follow-up operation cards share one bottom-sticky transcript stack, with bounded independent overflow, no separator/extra gap and ordinary user-turn styling/spacing. They stay visible during older-history reading without enabling auto-follow. Steering/Queued text shimmer never changes layout; reduced-motion labels are static and inactive/hidden presentation pauses it. Stack additions, streaming growth, consumption/error unpinning and recovery use the same capture/request path; never force-scroll or rebuild the adopted user article. [Composer](composer.md#pending-user-turns-in-the-transcript) owns delivery lifecycle.
- Local [configuration changes](model-thinking.md#local-configuration-transcript-entries) share the same sticky stack/shimmer and capture/request owner as steering/queued operation cards, but never create Send-style navigation or canonical harness messages. Same-key replacements patch the article/title span; terminal unpinning preserves reader intent and anchors the local marker before future turns. Hidden catch-up and reduced motion reuse existing boundaries; new fixtures are authored but unrun.
- Explicit bottom-navigation actions (valid notification click and qualifying local message submission under the preference below) override reading position/re-enable follow. Ordinary switching preserves it.

## Auto-follow after sending

**Global Settings → Appearance → Auto-follow after sending** is a global-only, app-wide synchronized preference, stored as `appearance.autoFollowAfterSending`: `always`, `whenIdle` (default), or `never`. TypeScript and Rust reject other values; omitted/deleted settings use the default. Existing installations without the key also receive the new default. Older project-file copies of this key are ignored and preserved without promotion; [Preferences](preferences.md#project-layering) owns compatibility and scope.

- Always: every locally validated message submission jumps to bottom and enables auto-follow, including steering and explicit queued follow-ups.
- When idle: only submissions made while the main agent is idle jump/follow. Busy steering and follow-ups preserve scroll intent; idle Option/Alt+Enter is an ordinary send. Background subagents do not count as main-agent work.
- Never: preserve current reader/follow intent, not disable existing auto-follow.
- Read the live preference and latest observed main-agent activity at local submission, after validation/clearing the draft and before dispatch/image preparation. Plain-text previews render through the same deferred follow owner; image preparation later respects the resulting intent and any intervening upward navigation.
- Reuse `TranscriptScroll.scrollToBottom()`; do not introduce a second scroll owner, smooth-scroll animation, focus change or acknowledgement gate. Upward navigation cancels follow immediately.
- Supported prompt slash expansions count as messages; `/name`, `/compact`, empty/blocked submissions and Stop do not navigate. Errors, receipts, authoritative user events and image readiness never repeat or undo the local jump.
- Preference edits/broadcasts alone never move a transcript, disable active following, mutate drafts or restart sessions. Failed saves restore the committed picker value and use the application notice strip.

Code: `src/preferences.ts` / `src-tauri/src/preferences.rs` validate/persist; `index.html` / `src/settings-surface.ts` own the global-only picker, synchronization and live renderer getter; `src/conversation-view-host.ts` / `conversation-view.ts` apply integration-classified local intent using the existing scroll owner.

Coverage added in preferences/native validation, shell Settings synchronization/failure and bundled renderer mode/delivery matrix, upward cancellation, late acknowledgement, slash/control exclusion and gated image-preparation fixtures. Offline browser idle-send cases cover all modes from bottom/history; default busy steering/queue cases retain reading, and idle image cases now expect follow. These changes have **not been run or natively verified** as part of this task; validation/build require explicit request.

## Focus, reset and zoom

Routine state/history refresh never focuses the composer. Explicit launch focuses once only when its session is still selected and no modal owns focus. Mounted view switching uses unique IDs and stable `data-pi-id` hooks; never reuse one renderer across sessions.

Explicit resume/restart resets session-local disclosure/composer presentation through the established boundary, without resetting siblings or replaying prompts. Settings uses HTML modality over unchanged underlying layout and restores prior focus; startup cannot focus through it.

Whole-app native webview page zoom is global-only (including shortcuts invoked in a project window), 75–200%, default 125%; reset is 100%. Never use font-size or CSS transforms as replacement. Requests serialize and only successful changes persist. Zoom doesn't refocus, mutate drafts or change harness state; resize/follow owns resulting geometry. [Keybindings](keybindings.md) owns dispatch/modal policy.

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

When validation of scrolling changes is explicitly requested, use `mise run test` and `npm run test:browser`; do not run tests/checks automatically. Fixtures use CSS zoom/mock native IPC, not native Tauri page zoom. Native trackpad/keyboard, 5K/multi-display geometry, animation timing and Linux/possible Windows webviews require user/platform acceptance.
