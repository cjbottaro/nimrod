# Settings layout

## Code map and invariants

- `index.html`: `#settings-page` remains a full-viewport native HTML dialog, with a `.settings-header` sibling above `.settings-content`.
- `src/theme.css`: the header is non-shrinking; the content is a full-width flex child (`flex:1`, `min-height:0`, `min-width:0`) with its own overflow and 20 CSS-pixel side gutters. Do not put a centered width cap or outer side margins on the scroll owner: that creates non-scrolling dead zones. Padding belongs inside the scroll owner.
- Individual controls can retain useful width limits (theme/zoom selectors); the page itself is fluid. The header and body share the 20px left alignment. Top padding is 20px, bottom padding 32px.
- Keep browser modality, Back/Escape, nested-dialog priority and prior-focus restoration in `src/settings.ts`. Do not hide/unmount the underlying project or change transcript scrolling to fix Settings geometry.
- This layout changes no preference storage, runtime Save boundary or session lifecycle. See `docs/settings.md` for those contracts.

## Regression coverage and platform limits

`test/browser/settings-layout.spec.ts` uses the offline app fixture in Playwright WebKit at wide, default and narrow viewport widths. It checks full-width body bounds, 20px padding, no horizontal overflow, wheel scrolling over both side gutters, the fixed header, and Back dismissal. No live Pi, model requests or native app launch.

`test/browser/settings-sync.spec.ts` retains coverage of background rendering and dirty Runtime fields. `test/settings.test.ts` covers navigation/modality.

Automated WebKit evidence is not native Tauri acceptance. Ask the user to check the packaged app's gutter scrolling and visual density; Linux/WebKitGTK and possible future Windows/WebView2 remain unverified.
