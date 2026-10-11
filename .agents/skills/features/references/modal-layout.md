# Shared modal layout and command rows

## Contract and code map

- `src/modal.css` is the sole ordinary-modal shell authority: `.nimrod-modal`, `--modal-*` geometry/spacing/backdrop tokens, `.modal-stack`, `.modal-header`, `.modal-title`, `.modal-description`, `.modal-body`, `.modal-actions` and `.modal-overlay`.
- `index.html` applies it to command palette, host input/select/confirm and deletion review. `src/keybinding-editor.ts` applies it to the dynamically created recorder. `src/pi/resume-modal.ts` applies it to the retained renderer picker. `src/pi/transcript.html` applies it to Pi's editor card/overlay.
- `src/main.ts` imports the shared stylesheet after content styles. Offline browser/view fixtures must also include it; esbuild fixtures discard CSS imports.
- No ordinary modal-specific selector may redefine shell width, position, padding, border, radius, surface, shadow or backdrop. Named-session and deletion-review width overrides were removed. Settings remains the explicit full-window exception in `src/theme.css`; native file choosers are not app modals.
- Native `<dialog>` and the existing Pi editor overlay share presentation, not lifecycle. Do not change native modality, acknowledgement, Escape/Back, request correlation, editor responses or focus restoration as part of styling. The editor remains the existing non-native overlay; this work does not claim improved modality/accessibility.
- Override the native dialog UA `max-width` cap in the shared shell; otherwise native dialogs and overlay cards differ by a few pixels at zoom/narrow widths.
- Scrollable bodies shrink within stack/form height limits; footer actions stay outside content scrolling. Shell overflow remains available for unusually long non-body content.

## Confirmation actions

`src/dialog-actions.ts` shares plain action labels and non-visual `aria-keyshortcuts`. Buttons contain label text only; no Enter SVG, Esc text or hint-specific styling. Picker-row hints are unchanged. `Dialogs.confirm` accepts an optional action label after owner; shell Close/Restart provide explicit labels, Pi retains Confirm. Input/select calls clear shortcut metadata and reset the generic label.

Host confirmations, populated deletion reviews and eligible keybinding resets focus the confirmation action. Enter honors Cancel focus (including descendant nodes), otherwise activates the enabled confirmation; Escape cancels. Repeated/composing/keyCode-229 Enter is consumed without activation. Native form return values/request correlation and close-time focus restoration remain unchanged. Key recording still captures shortcuts rather than treating Enter as Save. During async reset saving the existing click guards prevent duplicate save/cancel.

Deletion loading disables Delete, clears its Enter shortcut metadata and focuses Cancel. A visible loading-to-review transition preserves focus rather than moving it after the user has begun interacting; Enter on Cancel cancels both loading and populated review. Fresh ready-only reviews focus Delete. See session-deletion reference.

Unit tests cover default/Cancel focus, plain labels/shortcut metadata, IME/repeats and cleanup before input; offline WebKit tests cover actual Shift+Tab/Enter, default focus, absence of button hints, close restoration and retained drafts. Native visual acceptance and Linux verification remain pending.

## Command rows

`PaletteOptions.commands()` requires a `detail` string; picker items retain optional metadata. Every shell command supplies a short explanatory description in `src/main.ts`, rather than a project path/current value/session title. `src/command-palette.ts` appends the effective-binding `<kbd>` inside `.palette-item-heading`, after the flexible title, and the `.palette-item-description` below it. Unbound commands have no shortcut placeholder. Both fields stay visually secondary on selected rows. Picker-specific rows/order and MRU behavior remain unchanged. Descriptions participate in existing text filtering.

## Verification

- `test/command-palette.test.ts`: two-line command structure, heading shortcuts, unbound absence and description search.
- `test/browser/modal-layout.spec.ts`: actual WebKit right alignment/secondary descriptions; all six ordinary shells share computed geometry/surfaces at desktop and narrow sizes; changing shared width/padding tokens updates all consumers.
- Existing browser deletion/keybinding/ranking tests cover footer reachability, tree scrolling, focus, cancellation and retained drafts.
- Run `mise run check` and `npm run test:browser` locally with offline fixtures only. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow).
- Native visual acceptance and Linux/Windows verification remain pending; fixture success is not platform acceptance.

User guide: [Modal layout](../../../../docs/modal-layout.md), [Command palette](../../../../docs/command-palette.md).
