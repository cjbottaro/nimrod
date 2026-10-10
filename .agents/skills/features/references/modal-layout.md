# Shared modal layout and command rows

## Contract and code map

- `src/modal.css` is the sole ordinary-modal shell authority: `.nimrod-modal`, `--modal-*` geometry/spacing/backdrop tokens, `.modal-stack`, `.modal-header`, `.modal-title`, `.modal-description`, `.modal-body`, `.modal-actions` and `.modal-overlay`.
- `index.html` applies it to command palette, host input/select/confirm and deletion review. `src/keybinding-editor.ts` applies it to the dynamically created recorder. `src/pi/resume-modal.ts` applies it to the retained renderer picker. `src/pi/transcript.html` applies it to Pi's editor card/overlay.
- `src/main.ts` imports the shared stylesheet after content styles. Offline browser/view fixtures must also include it; esbuild fixtures discard CSS imports.
- No ordinary modal-specific selector may redefine shell width, position, padding, border, radius, surface, shadow or backdrop. Named-session and deletion-review width overrides were removed. Settings remains the explicit full-window exception in `src/theme.css`; native file choosers are not app modals.
- Native `<dialog>` and the existing Pi editor overlay share presentation, not lifecycle. Do not change native modality, acknowledgement, Escape/Back, request correlation, editor responses or focus restoration as part of styling. The editor remains the existing non-native overlay; this work does not claim improved modality/accessibility.
- Override the native dialog UA `max-width` cap in the shared shell; otherwise native dialogs and overlay cards differ by a few pixels at zoom/narrow widths.
- Scrollable bodies shrink within stack/form height limits; footer actions stay outside content scrolling. Shell overflow remains available for unusually long non-body content.

## Command rows

`PaletteOptions.commands()` requires a `detail` string; picker items retain optional metadata. Every shell command supplies a short explanatory description in `src/main.ts`, rather than a project path/current value/session title. `src/command-palette.ts` appends the effective-binding `<kbd>` inside `.palette-item-heading`, after the flexible title, and the `.palette-item-description` below it. Unbound commands have no shortcut placeholder. Both fields stay visually secondary on selected rows. Picker-specific rows/order and MRU behavior remain unchanged. Descriptions participate in existing text filtering.

## Verification

- `test/command-palette.test.ts`: two-line command structure, heading shortcuts, unbound absence and description search.
- `test/browser/modal-layout.spec.ts`: actual WebKit right alignment/secondary descriptions; all six ordinary shells share computed geometry/surfaces at desktop and narrow sizes; changing shared width/padding tokens updates all consumers.
- Existing browser deletion/keybinding/ranking tests cover footer reachability, tree scrolling, focus, cancellation and retained drafts.
- Run `mise run check`, `mise run build` and `npm run test:browser` locally with offline fixtures only.
- Native visual acceptance and Linux/Windows verification remain pending; fixture success is not platform acceptance.

User guide: [Modal layout](../../../../docs/modal-layout.md), [Command palette](../../../../docs/command-palette.md).
