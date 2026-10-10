# Shared sidebar resizing

The project and Settings share the layout/resize primitives with independent state. See [Settings categories and width](settings-layout.md) for that page's owner-dialog policy, app-wide broadcasts, bounds and non-overlay narrow layout. The contracts below describe Session sidebar defaults.

Read the [human guide](../../../../docs/workspace-sessions.md#sidebar-width),
[architecture](../../../../docs/architecture.md) and
[UI vocabulary](../../nimrod-ui-vocabulary/SKILL.md).

## Code map

- `src/sidebar-resize.ts`: validated preferred width, configurable bounds/default/width property/available cap/active predicate/owner dialog, shared pointer/keyboard interaction, zoom normalization, cancellation and teardown. Omitted options retain the existing Session sidebar defaults.
- `index.html`: `#sidebar-resizer`, a focusable vertical ARIA separator controlling `#session-sidebar`; it is a sibling of the independently scrolling sidebar.
- `src/workspace.css`: shared sidebar/content/edge-handle classes; Session sidebar width via `--session-sidebar-width`, overlay layout, 8px hit area with a themed hover/focus/drag line. The handle is absolutely positioned on the sidebar edge, so it takes no conversation space and does not scroll with the session list.
- `src/main.ts`: installs once, reloads at canonical-project entry, refreshes visibility in `controls`, disposes on unload and saves via the existing app-state writer/error surface.

## Storage and sizing

`nimrod.sidebar.width:<canonical cwd>` lives in app-managed state, not user settings or Pi files. A finite positive number is rounded/clamped to a 180–520 layout-pixel preference; invalid/missing/null values use existing responsive defaults (260 desktop, 210 at <=760px, 250 in <=600px overlay mode). Double-click resets the key to null/default. Other project widths are independent; external state changes do not rebuild already-mounted project layout.

Rendered width is additionally capped at 60% of available layout width on desktop or layout width minus 48px in narrow overlay mode. Minimum drops below 180 when required by that cap. Window resize/zoom changes clamp only presentation: the saved preference is not rewritten and returns when room is available. `ResizeObserver` watches the layout's width, not the sidebar, alongside window resize for media changes; observing the sidebar would cancel the drag on its own writes.

Rects are divided by the layout rect/offset-width scale to convert pointer displacement to unzoomed CSS pixels. This works with native page zoom and the browser fixture's CSS zoom. No native/macOS resizing API is used.

## Interaction invariants

- Left/primary pointer drag uses capture plus window move/up/cancel listeners. Writes are deferred until successful release, once per changed drag; not every movement. Pointerdown prevents default to retain composer focus. Other pointers/buttons are ignored.
- Native dialog `open` attribute changes are observed to cancel immediately if modality intervenes. Settings may explicitly allow its owner dialog; Session resizing allows none. Escape during a drag stops propagation so a Settings drag cancel does not also dismiss its page.
- Escape, pointercancel/lost capture, blur, viewport resize, sidebar hiding or a modal intervening before move/release cancel and restore the prior preference without writing. Dispose/reload also cancel. A no-op drag does not replace a larger preference temporarily constrained by the viewport.
- Focused separator: Left/Right change by 10px, Shift changes by 50px, Home/End choose current bounds. Keyboard writes persist immediately; modified/IME keys and modal/hidden interactions are ignored. Double-click resets the responsive default.
- ARIA min/max/current/value text reflect rendered layout pixels. Hiding a keyboard-focused separator returns focus to the toggle with preventScroll, unless a modal owns focus. Pointer resizing never selects a session or focuses its composer.
- No transcript/controller replacement, sidebar reorder, timestamp change, draft mutation, harness IPC, process lifecycle, acknowledgement inference or notification dispatch. Existing renderer resize handling owns live follow versus older-history pause. Sidebar content can naturally clamp if its bounds change.
- Persistence failures use the existing visible storage error; resizing itself stays local and there is no durable-write guarantee after an abrupt app exit.

## Tests and acceptance

- `test/sidebar-resize.test.ts`: restoration/validation, zoom-aware drag, once-per-release writes, focus/draft retention, pointer ownership, cancellation, keyboard bounds/reset, responsive defaults/caps, hidden/modal guards and disposal.
- `test/shell.test.ts`: real shell/mocked native boundary restores/persists per-project app state, preserves unrelated project sizes, hide/show/focus behavior and no settings or harness operations.
- `test/browser/sidebar-resize.spec.ts`: offline WebKit at 125% zoom covers real edge drag, restore in another fixture page, cancellation, window clamp/restore, keyboard/default reset, narrow-overlay handle alignment, pointer capture outside viewport, modal priority, unchanged mounted draft/tool/focus and both live follow and older-history pause during later streaming.

Latest verification: `mise run check` passed 312 TypeScript/Node tests, formatting/Clippy and 71 default Rust tests (two opt-in Pi smokes ignored); `mise run build` packaged and verified the macOS bundle; all 23 offline WebKit tests passed. Native visual/pointer/zoom acceptance remains outstanding.

Run `mise run check`, `mise run build` and offline `npm run test:browser`. No running user app, actual session files or real notification is used. Fixture WebKit does not establish native Tauri zoom/pointer, Linux or Windows acceptance; ask the user to validate dragging the packaged app's sidebar.
