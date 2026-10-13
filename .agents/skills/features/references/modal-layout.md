# Shared modal layout and command rows

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#modal-layout) retain prior execution records.

## Specification and acceptance criteria

Ordinary dialogs share a shell, not identical content. Confirmation labels remain plain, arrow keys navigate enabled footer actions, Enter follows focused action/Cancel, Escape cancels, and loading review retains Cancel focus after late population.

## Contract and code map

- `src/modal.css` is the sole ordinary-modal shell authority: `.nimrod-modal`, `--modal-*` geometry/spacing/backdrop tokens, `.modal-stack`, `.modal-header`, `.modal-title`, `.modal-description`, `.modal-body`, `.modal-actions` and `.modal-overlay`.
- `index.html` applies it to command palette, host input/select/confirm and deletion review. `src/keybinding-editor.ts` applies it to the dynamically created recorder. `src/pi/resume-modal.ts` applies it to the retained renderer picker. `src/pi/transcript.html` applies it to Pi's editor card/overlay.
- `src/main.ts` imports the shared stylesheet after content styles. Offline browser/view fixtures must also include it; esbuild fixtures discard CSS imports.
- No ordinary modal-specific selector may redefine shell width, position, padding, border, radius, surface, shadow or backdrop. Named-session and deletion-review width overrides were removed. Settings remains the explicit full-window exception in `src/theme.css`; native file choosers are not app modals.
- Whole-window translucency uses a shared denser glass panel, restrained endpoint-continuous scrim, and scoped field/inset surfaces. Opaque/sidebar-only/Reduce Transparency preserve the original solid appearance. [Translucency](translucency.md#shared-modal-glass) owns density/contrast calibration and button tint credit; `.nimrod-modal` consumes those values here. No per-dialog glass overrides or blur filters.
- Native `<dialog>` and the existing Pi editor overlay share presentation, not lifecycle. Do not change native modality, acknowledgement, Escape/Back, request correlation, editor responses or focus restoration as part of styling. The editor remains the existing non-native overlay; this work does not claim improved modality/accessibility.
- Override the native dialog UA `max-width` cap in the shared shell; otherwise native dialogs and overlay cards differ by a few pixels at zoom/narrow widths.
- Scrollable bodies shrink within stack/form height limits; footer actions stay outside content scrolling. Shell overflow remains available for unusually long non-body content.

## Confirmation actions

`src/dialog-actions.ts` shares plain action labels and non-visual `aria-keyshortcuts`. Buttons contain label text only; no Enter SVG, Esc text or hint-specific styling. Picker-row hints are unchanged. `Dialogs.confirm` accepts an optional action label after owner; shell Close/Restart provide explicit labels, Pi retains Confirm. Input/select calls clear shortcut metadata and reset the generic label.

`navigateDialogActions` shares footer-button navigation across host input/select/confirm dialogs, deletion review, keybinding recorder/reset dialogs and Pi's editor overlay. Unmodified Left/Up move backward and Right/Down move forward in DOM order, wrapping between enabled, non-hidden/non-inert Cancel and accept buttons. Navigation changes focus only, with no activation or scrolling; disabled Delete is skipped during loading. Repeated arrows can move focus; composing/keyCode-229 arrows are consumed without movement. Arrows from text fields, selects, the shortcut-recording input and other content retain their existing behavior; modified arrows are untouched. Palette pickers retain their existing list navigation (they have no Cancel/accept footer pair).

Host confirmations, populated deletion reviews and eligible keybinding resets focus the confirmation action. Enter honors Cancel focus (including descendant nodes), otherwise activates the enabled confirmation; Escape cancels. Repeated/composing/keyCode-229 Enter is consumed without activation. Native form return values/request correlation and close-time focus restoration remain unchanged. Key recording still captures shortcuts rather than treating Enter as Save. During async reset saving the existing click guards prevent duplicate save/cancel.

Deletion loading disables Delete, clears its Enter shortcut metadata and focuses Cancel. A visible loading-to-review transition preserves focus rather than moving it after the user has begun interacting; Enter on Cancel cancels both loading and populated review. Fresh ready-only reviews focus Delete. See session-deletion reference.

Unit fixtures cover all four arrow directions/wrapping, reversed DOM order, disabled/hidden/inert actions, modifiers, IME/repeats, editing controls, default/Cancel focus, plain labels/shortcut metadata and cleanup before input. Offline WebKit fixtures cover arrow navigation followed by Enter in temporary Close, deletion review and keybinding reset dialogs, default focus, absence of button hints, close restoration and retained drafts. The arrow-navigation additions have not been executed yet. Native visual acceptance and Linux verification remain pending.

## Command rows

`PaletteOptions.commands()` requires a `detail` string; picker items retain optional metadata. Every shell command supplies a short explanatory description in `src/main.ts`, rather than a project path/current value/session title. `src/command-palette.ts` appends the effective-binding `<kbd>` inside `.palette-item-heading`, after the flexible title, and the `.palette-item-description` below it. Unbound commands have no shortcut placeholder. Both fields stay visually secondary on selected rows. Picker-specific rows/order and MRU behavior remain unchanged. Descriptions participate in existing text filtering.

## Verification

- `test/dialog-actions.test.ts`, `test/dialogs.test.ts`, `test/deletion-review.test.ts`: shared arrow navigation, editing-control preservation and disabled/loading actions (arrow additions not yet run).
- `test/command-palette.test.ts`: two-line command structure, heading shortcuts, unbound absence and description search.
- `test/browser/modal-layout.spec.ts`: actual WebKit right alignment/secondary descriptions; all six ordinary shells share computed geometry/surfaces at desktop and narrow sizes; whole-window glass and field/inset alpha, opaque/sidebar-only and simulated Reduce Transparency fallbacks across dark/light palettes; changing shared width/padding tokens updates all consumers.
- Existing browser deletion/keybinding/ranking tests cover footer reachability, tree scrolling, focus, cancellation and retained drafts.
- Run `mise run check` and `npm run test:browser` locally with offline fixtures only. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow).
- Glass follow-up: 8 offline WebKit modal-layout/translucency/theme tests pass. The geometry fixture now explicitly mounts the actual keybinding recorder with no-op fixture storage; project boot intentionally does not install that global-only UI. Native visual acceptance and Linux/Windows verification remain pending; fixture success is not platform acceptance.

User guide: [Modal layout](../../../../docs/command-palette.md#confirmation-dialogs), [Command palette](../../../../docs/command-palette.md).
