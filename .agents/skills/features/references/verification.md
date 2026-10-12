# Verification status

This is the current evidence/acceptance map, not a chronological test log. Feature references own current specifications and test maps. [Historical records](history/verification.md) preserve prior runs, native observations and superseded implementation steps; never follow their old acceptance instructions as current UI.

## Evidence boundaries

- TypeScript/jsdom shell tests use mocked native IPC.
- Rust fixture tests use actual pipes, owned subprocesses and generated disposable session files; deletion tests unlink only those fixtures.
- Automated Playwright WebKit exercises real browser layout/events with an offline child fixture and mock Tauri operations. Its CSS zoom is not native WKWebView zoom.
- macOS bundles have been produced and signature-verified historically. Building/signing is not native delivery, focus or lifecycle acceptance.
- No Linux build/native parity or Windows acceptance is established by macOS checks. Windows remains a possible future target.
- Installed-Pi metadata smokes isolate config/projects/history and make no provider requests; they don't establish provider-generated first-save or queue behavior.

## Native observations retained

| Area | Evidence | Boundary |
| --- | --- | --- |
| Zoom | User confirmed the initial zoom improvement | Not every resize/5K/native input case |
| Card plugins, macOS declarative baseline | User restarted the built baseline and reported existing cards/requested-edit previews look good | Not the full executable API/action acceptance matrix |
| Pi Web Access external plugin, macOS | User reloaded the fixed personal TS source and confirmed a fresh code-heavy live web search stays visible; native trace plus offline regression identified escaped absolute Copy-status overflow | Limited reload/rendering/containment acceptance; not all host actions, cache performance or Linux/possible Windows parity |
| Deletion review | User accepted tree presentation and fast-preview transition | Not external-writer, partial-failure or cross-window acceptance |
| macOS notifications, 27.0.1 | Signed tests reached Notification Center; Persistent style made foreground test alerts visible | Temporary presentation inconsistent; cause unproven; not all event types or click routing |

Detailed provenance is retained in [history](history/verification.md#evidence-boundaries), [deletion acceptance](history/verification.md#native-deletion-integration-with-current-main) and [notification acceptance](history/verification.md#native-macos-foreground-presentation-acceptance).

## Remaining acceptance by area

| Area | User/platform checks still needed |
| --- | --- |
| Projects/startup | Finder runtime discovery, rapid cold/warm CLI forwarding, minimized-window focus, native window cycling and pop-out ownership |
| Drafts | Native typing feel, Close/Quit flush and crash/reload limits; [storage specification](native-drafts.md) |
| Sessions | Real first-save/exact-file resume, Close/Restart cancellation and failure, independent multi-window shutdown, no replay |
| Deletion | Native multi-window review/idle locks, recovery after partial filesystem failure, external mutation limits |
| Transcript/sidebar | Native zoom/trackpad/keyboard, follow/pause, disclosure animation, narrow/ultrawide geometry and view selection |
| Executable card plugins | Broader compiler packaging/cold-warm cache, trust/load failure, custom DOM/focus/reading and host-action matrices; Linux delivery. User-confirmed macOS Pi Web Access reload/rendering/containment is limited evidence, not general plugin/platform parity. |
| Settings/keybindings/themes | Native menus, alternative keyboard layouts, file chooser, live import/preview focus and cross-window preferences |
| Images | Native macOS screenshot paste, Linux/Wayland clipboard, reload/quota and real Pi image normalization |
| Pop-outs/window state | Quit/relaunch persistence, automatic versus explicit focus, own-window Close, minimization and multi-display/DPI geometry |
| Notifications | Native macOS session click, real input/failure delivery, Linux compilation/delivery/action/Wayland focus; Windows delivery remains unverified |

Use current [user guides](../../../../docs/README.md) for available actions. There is no app demo launcher or arbitrary session-file picker. Native testing with live Pi/models, notifications, user-session mutation or the user's app requires explicit authorization; offline fixtures remain automated tests only.

## Recording evidence

Run `mise run check`; scrolling changes also require offline `npm run test:browser`. Build only when explicitly requested, following [publication policy](build-cache.md). Do not launch/quit/restart the user's app automatically.

Keep current test coverage and outstanding acceptance in the relevant feature reference. Update this matrix only when native evidence changes. Significant regression investigations may be archived under `history/` with source revision/platform, actual scope and explicit supersession; avoid adding every intermediate run/test count to living specifications.
