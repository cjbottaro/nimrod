# Command palette

## Row layout

Every command has a short muted description beneath its title. Effective shortcuts appear right-aligned on the title line; unbound commands leave that space empty. Descriptions are searchable. Session/model/project pickers retain their own row metadata rather than adopting command descriptions.

Every current command has a default shortcut; customize or remove it in [Settings → Keybindings](keybindings.md). **Restart session** uses Cmd/Ctrl+R; **Edit keybindings…** uses Cmd/Ctrl+Shift+Comma. Offline demo and arbitrary session-file opening are not app commands; use **Resume session…** for saved project history.

The palette and its pages use the [shared modal layout](modal-layout.md), including the named-session step.

## Ordering

Open the command palette with **⌘/Ctrl ⇧ P**. Commands accepted through the palette appear first next time, most recently used first. Commands without retained history follow alphabetically.

Typing filters the list as before; matching commands retain that same recent-first ordering, rather than being ranked by text-match strength or frequency. Accepting a command that opens another page (such as **Resume session…**) counts immediately, even if you later cancel that page. Highlighting, Escape, Back and commands invoked through direct shortcuts or buttons do not count.

The latest 50 distinct command IDs are remembered app-wide in Nimrod's app-state file, shared across project windows and restored after restart. Unavailable commands remain hidden; their retained position is used when they become available again. Dynamic labels such as **Hide sidebar** / **Show sidebar** share one command identity.

This applies only to the command list. Switch session, Resume session, model and thinking-level pickers keep their existing order. There is no ranking setting yet; the initial strategy is VS Code-style MRU (most recently used), not frequency-based ranking.

If saving history fails, Nimrod reports it without blocking or retrying the selected command. Automated fixture tests cover ordering and persistence; native visual acceptance and Linux/Windows verification remain pending.
