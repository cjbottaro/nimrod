# Command palette

Open with **⌘/Ctrl+Shift+P**, type an action or description, then press Enter or click a result. Commands show a short description and their effective shortcut; unbound actions leave the shortcut space empty. Every palette command is bindable, but **Select theme…** has no default shortcut.

## Pickers and cancellation

Some commands open a picker or name field:

- [Open recent project](projects.md#open-a-recent-project) searches directories.
- [Switch/Resume session](sessions.md#switch-or-resume) searches open conversations or saved history.
- [Delete sessions](sessions.md#delete-several-conversations) supports repeated cleanup.
- [Model/thinking](model-thinking.md) marks the acknowledged current value with a **•**.
- [Select theme](themes.md#select-and-preview-themes) previews colors before saving.

**Escape closes the entire command interaction in one press**, including from a picker opened by a direct shortcut or Status-area button. It restores prior focus without changing your draft or stopping agents. Explicit **Back** returns to commands and retains the command query. Naming has Enter/Create and Escape, not a Back step.

Nested dialogs are different: a key recorder, Pi dialog or deletion review owns its own Escape. Deletion review leaves its picker visible underneath; Cancel returns unchanged, and Escape from the picker then closes it.

## Ordering

Commands accepted through the palette appear most recently used first next time. Unused commands follow alphabetically. Filtering retains that order, rather than ranking by match strength or frequency.

Opening a subordinate page counts immediately, even if you cancel it later. Highlighting, Escape, Back and direct shortcut/button invocation do not count. The latest 50 distinct command identities are remembered across projects and restarts. Subordinate pickers retain their own ordering.

History-save failures are reported without blocking or retrying the action.

## Confirmation dialogs

Confirmation buttons use plain action labels. The enabled confirmation action normally has focus; Enter activates it unless you move focus to Cancel, where Enter cancels. Escape cancels.

Deletion loading initially focuses Cancel while Delete is disabled. If that loading dialog is already visible when the tree arrives, focus stays where you left it; Tab to Delete or click it to proceed.

Settings is a separate full-window page; native file/directory choosers remain OS-controlled. Customize command shortcuts in [Keybindings](keybindings.md).
