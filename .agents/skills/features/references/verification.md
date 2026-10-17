# Verification status

This is the current evidence/acceptance map, not a chronological test log. Feature references own current specifications and test maps. [Historical records](history/verification.md) preserve prior runs, native observations and superseded implementation steps; never follow their old acceptance instructions as current UI.

## Evidence boundaries

- TypeScript/jsdom shell tests use mocked native IPC.
- Rust fixture tests use actual pipes, owned subprocesses and generated disposable session files; deletion tests unlink only those fixtures.
- Automated Playwright WebKit exercises real browser layout/events with an offline child fixture and mock Tauri operations. Its CSS zoom is not native WKWebView zoom.
- macOS bundles have been produced and signature-verified historically. Building/signing is not native delivery, focus or lifecycle acceptance.
- No Linux build/native parity or Windows acceptance is established by macOS checks. Windows remains a possible future target.
- Installed-Pi metadata smokes isolate config/projects/history and make no provider requests; they don't establish provider-generated first-save or queue behavior.

## Current automated validation

**Shared deletion coordinator follow-up is unvalidated.** Added fixtures cover a third registered deletion source using unchanged consumer wiring, scoped review ownership, common pending/stop/error/confirmed-success handling, recovery deduplication and unsupported-control explanations. A local initialize-only probe identified installed Copilot **1.0.98** with list/load/close but no deletion capability; local CLI help exposes only `sessions import`, not `sessions delete`. This establishes an actual capability blocker, not successful history/deletion interoperability. No conversation was created/loaded/listed/deleted, no prompt was sent and no app was launched. See [deletion](session-deletion.md#consumer-interface-and-copilot-deletion).

**Latest plugin-revocation/permission-order fixes, Copilot sidebar restoration, saved-history discovery and deletion lack fixture/native acceptance.** New fixtures cover selection during suspended revoking reloads, batched request/update ordering, same-batch cancellation, synchronous request errors, [Copilot sidebar persistence/exact loading](acp-harnesses.md#copilot-sidebar-restoration), [shared session-list/status plus Pi/Copilot discovery](session-history.md#fixtures-and-remaining-evidence) and [shared deletion operations/Copilot single-session deletion](session-deletion.md#consumer-interface-and-copilot-deletion). These fixtures have not been run; the prior gate results below do not cover them. Packaging/typechecking is separate from behavioral and native acceptance.

Full validation of the shared-view extraction from **`337ff7c`**, with the fixture expectation/Rust-formatting follow-up: `mise run check` passes **798 TS/Node tests**, **154 Rust tests** (2 installed-Pi smokes intentionally ignored), TypeScript compilation, **82-document** link/anchor validation, Rust formatting and Clippy. Full `npm run test:browser` passes **123 offline WebKit tests**. This includes shared-view policy/projection, mode controls, scoped plugin applicability, partial permissions, null patches, rich-content retention, busy configuration and full-duplex/blocked-stdin fixtures. See [harness presentation](harness-presentation.md#regression-guardrails-and-evidence).

The new projection test initially expected a shortened subagent label; its assertion now preserves Pi's unchanged `2 running agents` text. One full browser run failed the external TypeScript plugin local-input assertion after the card collapsed; three focused repetitions and the full rerun passed without changes to that test or production code. This remains an intermittent disclosure/timing caveat, not a claimed fix.

[ACP POC](acp-harnesses.md#current-foundation) coverage includes protocol/session ordering, cancellation/permissions, target-scoped plugins/public shell-helper bundling, independent native pipe ownership and mixed Pi/ACP shell/browser behavior. Browser ACP launches execute the real offline fixture subprocess through mocked Tauri IPC; this does not establish native Tauri window/IPC or installed-agent compatibility. The ACP command's description no longer shadows Pi Resume searches; ranking and Pi lifecycle semantics are unchanged. Five stale Pi browser expectations were independently reproduced on `a3e1919` and corrected to their current contracts (settled result-processing, retained deletion review and no-Send-jump reader intent). Settings-window closing also tolerates the expected WebKit post-close keyup error only after confirmed page closure. No app launch, real Copilot/second-agent startup, paid model work or native/platform acceptance occurred.

Appearance-regression follow-up: TypeScript compilation and Rust formatting/Clippy pass; 71 targeted appearance/presentation/theme/preferences tests, 8 offline WebKit translucency/theme/Settings/pop-out tests and 144 Rust tests pass (2 installed-Pi smokes intentionally ignored). Browser evidence uses mock native material, title and Settings ownership—not a native app launch, macOS visual acceptance or Linux verification.

90%-density follow-up: TypeScript compilation, 20 focused button/appearance tests and 8 offline WebKit modal-layout/translucency tests pass. Contrast is now a lower bound on the eased role curve, not the base of a second ramp; dark Nimrod's normal fill at 90% is ~65% rather than ~80%. Independent legacy-fill comparison covers dark/light system schemes, multiple palettes, both areas and normal/hover states. This covers all palette contrast bounds with known parent tint, composited density, all six shared shells and opaque/sidebar-only/simulated reduced-transparency fallbacks. No native app acceptance/build/launch is implied.

## Native observations retained

| Area | Evidence | Boundary |
| --- | --- | --- |
| Performance, packaged macOS aarch64 | User reported snappy input/scrolling under high CPU load after unchanged bookkeeping-write suppression; supplied reports show ~59 callbacks/sec after focus and 5 ms median keyboard-event delay | Limited observational comparison, not controlled A/B, actual compositor FPS or a proven sole root cause; see [performance observation](#performance-observation) |
| Translucency hierarchy, macOS user trial | User reported “Much better” after continuous surface-density changes; supplied screenshot shows remaining cold-Settings flash and brown-looking native title bar | Limited visual feedback, not full slider/theme/native-material acceptance. The new first-reveal/title-tint fixes are not yet accepted. |
| Zoom | User confirmed the initial zoom improvement | Not every resize/5K/native input case |
| Card plugins, macOS declarative baseline | User restarted the built baseline and reported existing cards/requested-edit previews look good | Not the full executable API/action acceptance matrix |
| Pi Web Access external plugin, macOS | User reloaded the fixed personal TS source and confirmed a fresh code-heavy live web search stays visible; native trace plus offline regression identified escaped absolute Copy-status overflow | Limited reload/rendering/containment acceptance; not all host actions, cache performance or Linux/possible Windows parity |
| Images, idle Send | User reported an ordinary idle text/image submission appearing twice, with a trailing preview following assistant output | Normalization mismatch reproduced locally; started-preflight correlation is fixture-verified, not yet native-accepted |
| Deletion review | User accepted tree presentation and fast-preview transition | Not external-writer, partial-failure or cross-window acceptance |
| macOS notifications, 27.0.1 | Signed tests reached Notification Center; Persistent style made foreground test alerts visible | Temporary presentation inconsistent; cause unproven; not all event types or click routing |

Detailed provenance is retained in [history](history/verification.md#evidence-boundaries), [deletion acceptance](history/verification.md#native-deletion-integration-with-current-main) and [notification acceptance](history/verification.md#native-macos-foreground-presentation-acceptance).

## Performance observation

The user supplied five local reports from the release app on macOS aarch64, with native webview runtime `22625.1.29.11.28`, 125% zoom and reported device pixel ratio 2.5. After unchanged bookkeeping-write suppression (implementation commit `683f890`), the user reported CPU usage still near saturation while typing and scrolling felt snappy. A later capture recorded milder sluggishness with much more background presentation activity.

| Report context | Callback cadence | Keyboard-event delay, median / p95 | Input to next callback, median / p95 |
| --- | --- | --- | --- |
| Two initial sluggish captures under reported load | ~21–22/sec | 32–46 / 60–227 ms | 41–45 / 50–54 ms |
| Snappy baseline after restart with fewer connected sessions | ~57/sec overall; ~60/sec once settled | 5 / 21 ms | 9 / 15 ms |
| Post-change snappy capture under reported load | ~57/sec overall; ~59/sec in fully post-focus intervals | 5 / 19 ms | 14 / 16 ms |
| Subsequent mildly sluggish capture | ~51/sec over retained samples | 13 / 57 ms | 6 / 37 ms |

The post-change snappy capture contains 507 keyboard-event samples and 482 composer-input samples, all after its focus marker. Earlier severe frame/timer delays cluster just before focus; background throttling is plausible, not independently established. The subsequent mildly sluggish capture retained ~45 seconds after reaching its sample cap, with 451 hidden transcript paints (~1.3 seconds of measured render work), versus one hidden paint in the prior snappy capture. Keyboard-event delay peaked at 108 ms. This motivates further work on background presentation but does not prove that hidden painting caused the delay.

Captures measure JavaScript callback/event timings, not actual screen presentation or complete OS input latency. CPU utilization is user-reported, not sampled by the diagnostics; no CPU level was independently established for the later mild-slowdown capture. Session/restart state and snapshot traffic also differ, so the reports support improvement plus remaining opportunities without proving the persistence change was the sole cause or fixed every workload. Reports lack a unique source-build revision; association with the change comes from the user's trial context.

Source report basenames (local files, not checked into this repository; retention can remove them): `performance-1791845785765-20e63c54-c498-4306-92c8-e4be79df7a7d.json`, `performance-1791846158357-09285147-3967-4310-8d11-f8bea3c20c57.json`, `performance-1791847944819-41ce150a-166d-4ceb-9b87-7bd041cbdff9.json`, `performance-1791851420259-c11186de-3d45-4b70-a48c-cd5e3bd5837e.json`, and `performance-1791854360847-b76ded30-bc5e-4ee5-b69e-bcbc12619c08.json`.

[Preferences](preferences.md#unchanged-bookkeeping-writes) owns the implemented optimization and avoided-work fixtures. [Performance diagnostics](performance-diagnostics.md) owns timing semantics/privacy; the [performance optimizations catalogue](../../performance-optimizations/SKILL.md) records completed work and deferred candidates. Instrumentation overhead, broader session/history scaling, native engine/scheduler attribution and Linux/possible Windows behavior remain unverified. These captures predate hidden-paint suppression and do not measure its effect. Hidden-paint suppression is now implemented with regression coverage added but not run; native responsiveness/reveal-latency acceptance is pending. See the [optimization reference](../../performance-optimizations/references/hidden-session-painting.md). No priority, worker or separate-webview change was made.

Incremental streaming now adds indexed tool updates, dirty-row presentation, append-only text/ANSI rendering and affected-output scroll batching. Its new unit/DOM/shell/offline-browser fixtures, including the review-fix differential lifecycle and mixed-helper/custom-DOM raw-recovery cases, have not been run; there is no native before/after responsiveness claim. Existing reports do not establish its effect. Remaining cumulative Pi-JSON/rendered-prefix costs, immutable array pointer copies and fallback/Markdown work are detailed in the [incremental rendering reference](../../performance-optimizations/references/incremental-transcript.md).

## Remaining acceptance by area

| Area | User/platform checks still needed |
| --- | --- |
| ACP POC | Compact command-permission previews and their new unit/shell/browser fixtures are source-implemented but unvalidated; native wrapping, code viewport, raw disclosure, button/focus and cancellation acceptance remain pending. Installed Copilot and second-agent interoperability, list/load/delete capability/schema and cross-process history discovery/pagination, exact saved-sidebar loading/replay/draft recovery across process restarts, packaged Tauri IPC/window/permission/focus/shutdown behavior, platform-specific launch discovery; offline fixtures are not native app acceptance. Copilot Resume discovery and advertised single-session deletion are source-implemented but unvalidated; custom history/attachments/login/client services remain unimplemented. |
| Projects/startup | Finder runtime discovery, rapid cold/warm CLI forwarding, minimized-window focus, native window cycling and pop-out ownership |
| Drafts | Native typing feel, Close/Quit flush and crash/reload limits; [storage specification](native-drafts.md) |
| Sessions | Real first-save/exact-file resume, Close/Restart cancellation and failure, independent multi-window shutdown, no replay |
| Deletion | Working-session deletion and retained stopping/removal modal are implemented with new/updated fixtures, not yet run. User reported needing two deletion attempts; review-time fingerprint/report rejection paths were removed, but that live case is not reproduced or native-accepted. Native multi-window shutdown/expanding descendant locks, partial filesystem failure recovery and external mutation limits remain unverified. [Specification](session-deletion.md) |
| Transcript/sidebar | Native zoom/trackpad/keyboard, follow/pause, disclosure animation, narrow/ultrawide geometry and view selection |
| Executable card plugins | Copilot read/search/find-file cards and their new unit/offline-browser fixtures are source-implemented but unvalidated; native summaries, raw recovery, focus/reader positions and output rendering await acceptance. Broader compiler packaging/cold-warm cache, trust/load failure, custom DOM/focus/reading and host-action matrices; Linux delivery. User-confirmed macOS Pi Web Access reload/rendering/containment is limited evidence, not general plugin/platform parity. |
| Error presentation | Native macOS scoped-notice visuals, reader/focus preservation, announcements, dialog layering and page zoom; Linux/WebKitGTK remains unverified. Offline fixtures are not native acceptance. |
| Tool activity capture | Source implemented; fixtures authored but not run. Verify actual Pi/extension and ACP JSONL collection, global setting synchronization, private XDG paths, multi-window/process appends, failure/recovery and shutdown tails on macOS/Linux. No native/platform acceptance. [Specification](tool-capture.md) |
| MCP inspector | Native macOS appearance/focus, installed-Pi status compatibility, busy-session inspection and cancellation; fixtures added but not run. Linux behavior unverified. [Inspector specification](mcp-inspector.md) |
| Settings/keybindings/themes | Native menus, alternative keyboard layouts, file chooser, live import/preview focus and cross-window preferences |
| Translucency | User's initial trial reported opaque Status-area/notices/buttons and near-opaque frosting. The light-overlay follow-up then lost panel distinction below 100%. User subsequently reported the continuous hierarchy as much better. Latest user-reported regressions also include poor Nimrod button-label contrast and Settings-only drag previews. Shared filled-control contrast, generation-owned live opacity previews and the glass-modal/parent-tint button follow-up pass targeted offline coverage, but are not native-accepted. Cold Settings flash and brown-looking title bar also remain unaccepted; first-reveal/theme-tint changes and fixtures are unvalidated. Material/window-local appearance and full slider/theme coverage still need acceptance. Packaged macOS visuals, blur removal, Reduce Transparency, theme previews, resize/full-screen and streaming performance need acceptance; Linux alpha/compositor integration unverified. [Specification](translucency.md) |
| Images | Native macOS screenshot paste, Linux/Wayland clipboard, reload/quota and real Pi image normalization |
| Pop-outs/window state | Quit/relaunch persistence, automatic versus explicit focus, own-window Close, minimization and multi-display/DPI geometry |
| Notifications | Native macOS session click, real input/failure delivery, Linux compilation/delivery/action/Wayland focus; Windows delivery remains unverified |

Use current [user guides](../../../../docs/README.md) for available actions. There is no app demo launcher or arbitrary session-file picker. Native testing with live Pi/models, notifications, user-session mutation or the user's app requires explicit authorization; offline fixtures remain automated tests only.

## Recording evidence

Run tests/checks only when explicitly requested, per repository `AGENTS.md`. Requested validation uses `mise run check`; scrolling validation also includes offline `npm run test:browser`. Build only when explicitly requested, following [publication policy](build-cache.md). Do not launch/quit/restart the user's app automatically.

Keep current test coverage and outstanding acceptance in the relevant feature reference. Update this matrix only when native evidence changes. Significant regression investigations may be archived under `history/` with source revision/platform, actual scope and explicit supersession; avoid adding every intermediate run/test count to living specifications.
