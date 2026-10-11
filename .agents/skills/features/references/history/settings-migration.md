# Settings migration and initial verification record

Historical source retained from the former mixed-audience Settings guide. It is not the current specification; see [preferences](../preferences.md), [Settings layout](../settings-layout.md) and [current acceptance status](../verification.md).

## Implementation and verification

- `index.html` / `src/theme.css` / `src/workspace.css`: category sidebar, mounted category panes and shared sidebar/content geometry.
- `src/settings-navigation.ts` / `src/sidebar-resize.ts`: category navigation and shared zoom-aware resizing with independent persistence scopes.
- `src/settings.ts`: navigation/shortcut handling and the explicit runtime Save boundary.
- `src/preferences.ts`: JSONC edits, legacy migration, revision-ordered synchronization, and native persistence bridge.
- `src-tauri/src/preferences.rs`: XDG paths, serialized/atomic writes, file polling, last-valid snapshots, and conflict checks.
- `src-tauri/src/window_state.rs`: project-scoped native geometry capture/restoration.
- `src/main.ts`: preference initialization, next-launch snapshot, and startup focus guard.
- `test/preferences.test.ts`, native preferences tests, `test/settings.test.ts` / `test/shell.test.ts`: JSONC preservation, migration, external edits, stale revisions, conflicts/failures, dirty-field retention, startup focus, and renderer updates behind Settings. Native geometry tests check scope/validation, not actual window placement.
- `test/browser/settings-layout.spec.ts`: offline WebKit category switching, retained edits/search/scroll, narrow/wide pane geometry, gutter scrolling, shared resizing at 125% fixture zoom, reset, modal priority and width restoration. `test/shell.test.ts` also checks width broadcasts to another project window. These are fixture results, not native macOS/Linux/Windows acceptance.
- `scripts/check-settings.mjs`: optional local Chromium dialog/layout check, including background focus containment, focus restoration, retained geometry/scroll/draft/disclosure/spinner identity, nested dialogs, and saved runtime snapshots. Uses controlled animation-frame scheduling; does not establish native animation timing or WebKit acceptance.

```sh
CHROMIUM=/path/to/chrome-headless-shell node scripts/check-settings.mjs
```

This replaces the earlier project-bar theme/zoom pickers and launch-form runtime fields. Theme discovery and live previews are available through the command-palette [Select theme… picker](../../../../../docs/themes.md#select-and-preview-themes); Settings retains its existing selection/import/removal controls.
