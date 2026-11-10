# App-owned control patterns

**Status: source implemented; new fixtures authored, unrun.** This reference owns shared value/action and secondary-action affordances. [Settings layout](settings-layout.md), [typography](typography.md), [command interactions](command-interactions.md), [model/thinking](model-thinking.md) and [error presentation](error-presentation.md) retain their concrete semantics.

## Roles

- **Choice control:** show the current value separately from an outlined Change… button. Settings uses this for autocomplete acceptance, zoom, modal animation and auto-follow; fonts retain their existing installed-font picker. Default annotations belong in picker details, not current-value text. Project provenance remains a separate column where supported.
- **Binary preference:** use a labelled native checkbox, not a two-option dropdown or a modal. Background session alerts, transcript logging and performance diagnostics retain their existing scope, persistence, failure reconciliation and disabled-state semantics. Privacy/content warnings remain visible.
- **Utility button:** an app-owned secondary action gets a visible boundary before hover. Settings actions, font-picker Refresh, Keybindings controls, actionable notices, operation-card Cancel and edit-preview Copy/Wrap opt in.
- **Ghost button:** a low-emphasis action embedded in an existing surface has no resting border or fill, a subtle hover background and a visible keyboard-focus outline. All Status-area buttons—including configuration, actionable metrics and recovered-message Restore—use this treatment.
- **Exceptions:** navigation/Close, category/session tabs and rows, disclosures, picker options, dismiss icons, native OS controls, sliders/steppers, Runtime text fields, primary Send/Stop/confirmation actions and already-recognizable code-action icon controls keep their existing presentation. Noninteractive metrics remain text. Dormant ACP UI and external personal-plugin-owned controls are not blanket-restyled.

## Shared utility styling

`src/utility-button.css::button.utility-button` supplies foreground text, a transparent background and a 1px foreground-derived outline. Hover adds a subtle foreground-derived tint; an explicit `aria-pressed=true` utility toggle retains a stronger tint. Focus uses the shared focus token and forced-colors uses system colors. Owners retain context-specific sizing. This is an unfilled control treatment; the [filled-button contrast/density policy](translucency.md#filled-control-contrast) is unchanged. Do not copy Settings styles into transcript/notice surfaces or patch individual theme palettes.

`src/main.ts` and `src/popout.ts` import the shared stylesheet. Standalone/offline renderer fixtures must include it explicitly when CSS imports are discarded. The same stylesheet supplies the separate `button.ghost-button` visual variant with no border, transparent resting background, themed hover feedback, disabled-hover suppression, keyboard focus and forced-colors feedback. The mounted conversation applies the ghost class to Status-area controls without replacing nodes or writing unchanged class attributes on routine snapshots. Harness contributions still determine availability, labels, actions and confirmed configuration. Borders are not permission to rebuild the Status area, flatten capabilities or add actions to reported text.

## Settings choice lifecycle

`src/settings-choice-controls.ts` defines the bounded lists plus composition-supplied [default harness](session-creation.md) choices and separate value-label painting. `settingsChoicePage` uses `command-palette.ts::startSelection` with the exact open Settings parent and standalone choice presentation. The parent remains mounted; unrelated/nested dialogs or an already-open palette block entry. Choice markers track the current value. Enter/click resolves after close-time focus restoration; Escape/native cancel causes no preference write. This does not use theme hover-preview or rollback semantics. No additional field-action keybindings or commands are introduced.

Each existing setting owner still commits through its existing callback: autocomplete/auto-follow and animation preserve preference/error reconciliation, animation retains local preview/version guards, and Zoom retains serialized native application followed by persistence. Label painting is separate from writes/events; initial/reload paint never manufactures input/change events. Accepted choices alone invoke the owner. Disposal aborts control callbacks and rejects late selections.

## Fixtures and acceptance

- `test/conversation-view.test.ts` and `test/native-view.test.ts`: Status-area configuration/actionable metrics and recovered-message Restore opt into ghost styling while retaining dispatch and recovery behavior. These assertions are authored, unrun; native visual acceptance remains pending.
- `test/settings-choice-controls.test.ts`: plain values, current marker, accepted choice/focus, Escape/native cancellation, unrelated-dialog priority and disposed late acceptance.
- Existing shell/Zoom/typography fixtures retain persistence, version/error, cross-window provenance, disabled state and mounted conversation contracts; binary assertions use checked state.
- Offline browser fixtures select through the actual picker or native checkbox rather than synthetic dropdown events. Shared utility CSS is included in demo/reference/standalone fixtures. Existing Settings layout coverage remains separate from native acceptance.

New/updated fixtures are authored, not run for this task. Only the mandatory post-merge compile check is automatic. Native macOS/Linux layout, contrast across palettes, focus/keyboard behavior and possible future Windows acceptance remain unverified; ask the user to validate the packaged app. Tests/builds require explicit authorization.
