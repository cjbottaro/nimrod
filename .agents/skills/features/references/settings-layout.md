# Settings layout and category navigation

## Code map

- `index.html`: full-viewport native `#settings-page` dialog; fixed `.settings-header` above `#settings-layout`. Category sidebar buttons are vertical ARIA tabs controlling mounted `.settings-panel` tabpanels. Appearance initially shown; Notifications/Runtime initially hidden. Keybindings is inserted before Runtime by `src/keybinding-editor.ts` before navigation initializes.
- `src/workspace.css`: shared `.sidebar-layout`, `.layout-sidebar`, `.layout-content` and `.sidebar-resizer` primitives used by both Settings and the project. Each layout aliases its own width variable into `--sidebar-width`. Session-only overlays, filters, recency and activity styles stay separate.
- `src/theme.css`: category selection/hover styling, full-width panel overflow and 20px interior side/top gutters (32px bottom). The content wrapper does not scroll: each panel independently owns overflow. Do not center/cap the scroll owner or put its gutter outside it. Global preference errors remain above the selected panel; file paths live under Runtime.
- `src/settings-navigation.ts`: category selection, vertical Up/Down wrapping, Home/End, roving tabindex and hidden-panel projection. It guards closed pages and nested dialog ownership, and never recreates controls. Selection survives reopening only within that window. It is not persisted or synchronized.
- `src/sidebar-resize.ts`: same controller for both sidebars; optional width property, bounds/default, available-width cap, active predicate and allowed owner dialog. Defaults preserve existing Session sidebar behavior. Native dialog `open` changes trigger immediate drag cancellation/visibility refresh. Escape cancels a drag without propagating to close the owner page.
- `src/main.ts`: installs navigation after the Keybindings editor; Open keybindings explicitly selects its panel before focusing search. Separate Settings width callbacks read/write through `preferences`, not the project's `localState` cache. Subscription reloads only when the width key changes, avoiding cancellation on unrelated updates. Existing `src/settings.ts` retains page modality/Back/Escape and Runtime Save semantics.

## State and sizing

`nimrod.settings.sidebar.width` in app-managed state is independent of `nimrod.sidebar.width:<canonical cwd>`. Valid Settings preferences are rounded/clamped to 160–360 CSS pixels; default 220. Double-click saves null/default. Its rendered maximum is the lesser of 360, 45% of layout width, and layout width minus 240px (bounded at zero). The minimum decreases when the viewport cap requires it. Narrow Settings stays split rather than inheriting the Session sidebar's overlay/collapse policy; category labels ellipsize if necessary. Window/zoom clamping does not rewrite the preferred value.

Successful release saves once; keyboard/reset saves immediately via the existing native app-state writer and error surface. Width restores across projects/restarts and receives revision-ordered broadcasts into already-mounted windows, even with Settings closed. A width broadcast cancels an in-progress drag, preferring the authoritative saved value. No category selection, search, scroll offset or Runtime dirty value is saved as part of resizing. Persistence failures surface locally and do not guarantee durability.

## Invariants

- Keep all panels mounted. Category switches preserve unsaved Runtime fields, Keybindings queries and per-panel offsets; reopen preserves the last category in that window. Restart loses transient navigation/editing state.
- Session and Settings widths are independent. Never share session membership, recency/filter controllers, project-local caches or native process semantics merely to share layout.
- Allow resize interaction within Settings only while that exact owner dialog is open. Nested Pi/Keybindings dialogs block navigation/resizing; opening one, closing Settings, blur or viewport changes cancel an unfinished drag without saving. Closed/hidden handles cannot mutate state.
- Keep browser modality, nested-dialog priority, prior-focus restoration and underlying project geometry. No transcript/controller replacement, harness IPC, prompts, session teardown or draft mutation from category selection/resizing.

## Tests and acceptance

- `test/settings-navigation.test.ts`: vertical tab wrapping, mounted dirty controls/offsets, owner/nested modality and disposal.
- `test/shell.test.ts`: app-wide width restore/save/broadcast across two project windows, independent project widths/categories and no harness/settings operations.
- `test/browser/settings-layout.spec.ts`: offline WebKit wide/default/narrow split bounds, no horizontal overflow, gutter-inclusive panel scrolling, fixed sidebar/header, retained edits/search/reading/category, keyboard tabs, zoom-aware dragging, preferred-width clamp/restore, keyboard/default reset, drag Escape versus page Escape, nested recorder guard and restoration in another window fixture.
- Existing sidebar resize unit/browser regressions preserve session behavior, zoom, focus/drafts, live follow and older-history pause. `test/browser/settings-sync.spec.ts` keeps dirty Runtime/background rendering coverage; browser Keybindings/notification tests now explicitly select their categories.
- `scripts/check-settings.mjs` includes shared layout CSS and navigation, and explicitly selects categories for its isolated Chromium modality/geometry check.

Run `mise run check`, `mise run build` and `npm run test:browser`. Fixtures do not launch the user's app, call models, read real sessions or post native notifications. Passing WebKit/DOM tests are not native Tauri acceptance; ask the user to validate visual density, zoom/pointer resize and two-window synchronization in the packaged macOS app. Linux/WebKitGTK and possible future Windows/WebView2 remain unverified.
