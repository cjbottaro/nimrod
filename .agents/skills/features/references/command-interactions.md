# Command interactions

Human guide: [Command interactions](../../../../docs/workspace-sessions.md#command-interactions).

## Ownership and extension points

`src/command-palette.ts` owns the window-local command interaction. Commands, session pickers, model/thinking selections and naming are pages within that interaction—not a stack of parent dialogs. `src/main.ts` supplies commands and session-bound preference operations; `src/keybindings.ts` supplies entry-point dispatch. `index.html` supplies the shared modal and Escape hint.

Add a picker through `startSelection()` or the existing page lifecycle, not a feature-specific dialog key handler. `beginPage()` owns query reset, Back/Retry controls and request generation. Page content may differ; dismissal must not branch on page mode or entry point. There is no new generic harness or global modal framework.

Command-list sorting and accepted-command history are independent of page lifecycle; see [Command ranking](command-ranking.md). Subordinate picker order is unchanged.

## Lifecycle contract

- Escape from any control and the native dialog `cancel` event call `closeInteraction()` with no action. Public `close()` and an active selection request's `cancel()` use the same path. All dismiss the entire interaction; none invoke commands or navigate backward.
- `closeInteraction(action?)` is the sole controlled close boundary. It synchronously invalidates request generations, resolves a pending choice to `undefined`, clears naming/Retry callbacks, and closes the modal. Metadata RPCs may finish in the background, but cannot update or reopen a dismissed page or mutate a preference through a canceled choice.
- Successful selection/naming passes an action to that same boundary. The native `close` event restores the original workspace focus before running the accepted action in a microtask. Canceling is distinct from accepting an action; failure never replays it.
- Native `close` events are queued. New interactions are blocked while closing, so a previous close event cannot invalidate a new page, replace its opener, or steal its focus. Activation also requires an open dialog. Duplicate input after closing is inert.
- The close listener retains cleanup for external/native closes. Focus restoration checks that the opener is connected, visible/not inert, and no higher-priority dialog is open.
- Only the explicit Back button calls `commands()`. Back cancels pending choice/naming state, invalidates stale results and restores the command query while keeping the modal open. Naming retains its compact UI without a Back button.
- IME/229 remains excluded from keyboard cancellation/activation. Native modality and the shell dispatcher preserve higher-priority Pi dialogs. Genuine nested dialogs (Pi extension above the palette, recorder inside Settings) retain their own cancellation; Escape is not a global close-all-dialogs command.

## Model and thinking-level selection markers

`SelectionRequest.choose()` maps Pi's acknowledged current value to `PaletteItem.current`, independently of the navigation index. Selection pages render an aria-hidden typographic `•` in a fixed 14px `.palette-selection-marker` slot for every row (empty for unselected values); `src/workspace.css` sizes it at 1.1em with the separator's muted foreground. No session-indicator primitive, circle background or Current subtitle is used. `aria-current=true` exposes the current value, while the existing `aria-selected`/`aria-activedescendant` contract continues to track keyboard navigation. Row highlights and hover remain separate from the bullet, including after filtering. Pi acknowledgement, cancellation and focus behavior are unchanged.

## Regression coverage

- `test/command-palette.test.ts`: all current page kinds and a future-feature selection, direct/palette entry, keyboard/native/API dismissal, pending-choice cancellation, deferred native close, stale metadata, explicit Back/query retention, accepted action after focus restoration, IME/repeated Enter and refresh/error paths.
- `test/shell.test.ts`: direct session/model/thinking shortcuts and status controls now assert one-Escape closure, with drafts, session lifecycle and prompt-free behavior retained; Pi dialog priority is unchanged.
- `test/browser/preferences.spec.ts`: both picker bullet markers, blank-slot label alignment and separator-relative size, independent keyboard/hover highlights, and acknowledged effort changes without submitting the draft. On `fix/picker-selection-bullet`, `mise run check`, all 36 offline WebKit tests and the signed macOS worktree build pass; native visual acceptance and Linux/Windows verification remain pending.
- `test/browser/keybindings.spec.ts`: direct shortcuts dismiss in one press and retain composer focus/draft.
- `test/browser/workspace-tabs.spec.ts`: offline streaming continues under the palette; explicit Back retains the command query and one Escape from Resume restores the untouched composer. Naming cancellation retains the live session.

Verification on `fix/palette-dismissal`: `mise run check` passes 358 TypeScript/Node tests, formatting/Clippy and 93 default Rust tests (two opt-in Pi smokes ignored); all 33 offline WebKit tests and the signed macOS worktree build pass. See [verification](../../../../docs/verification.md#one-step-command-interaction-dismissal).

Run `mise run check`, `mise run build` and offline `npm run test:browser`. Fixture/WebKit coverage does not establish native Tauri focus acceptance or Linux/Windows parity. Do not launch or interrupt the user's app for validation.
