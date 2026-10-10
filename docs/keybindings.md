# Keybindings

Open **Settings → Keybindings**, or use **Edit keybindings…** in the command palette.

Search by action name, shortcut, or “modified.” Click a shortcut to change it, or **Add** to assign another. Press the desired combination in the recorder, then **Save**. Escape cancels; recording never executes the shortcut. Changes are saved and synchronized across project windows.

- **×** removes that shortcut. Removing every shortcut leaves the action unbound, not reset.
- **Reset** restores an action’s complete built-in shortcut list.
- **Reset all…** asks for confirmation, then clears all customizations and restores defaults.
- Conflicts name the competing actions. **Reassign** explicitly removes those competing shortcuts before saving. Resetting one action can also require reassignment if another action has borrowed its defaults.
- A failed save retains the current bindings. External edits that introduce new conflicts during a save require review rather than silently stealing another shortcut.

## Defaults

Use **Cmd** on macOS or **Ctrl** on Linux:

| Action | Shortcut |
| --- | --- |
| New session | Cmd/Ctrl+N |
| New named session… | Cmd+Option+N / Ctrl+Alt+N |
| New temporary session | Cmd/Ctrl+Shift+N |
| Delete session tree… | Cmd/Ctrl+Backspace |
| Select model… | Cmd/Ctrl+M |
| Select thinking level… (“effort”) | Cmd/Ctrl+E |
| Command palette | Cmd/Ctrl+Shift+P |
| Switch session… | Cmd/Ctrl+T |
| Resume session… | Cmd/Ctrl+K |
| Close session | Cmd/Ctrl+W |
| Toggle session sidebar | Cmd/Ctrl+B |
| Previous / next open session | Cmd/Ctrl+Shift+[ / ] |
| Settings | Cmd/Ctrl+, |
| Zoom in / out / reset to 100% | Cmd/Ctrl+Plus / Minus / 0 |

**Switch session** searches only open sessions, including temporary sessions and sessions hidden by the sidebar view. **Resume session** searches saved project history, including closed sessions; choosing an already-open entry focuses it. **New named session** opens the name field first; type a name and press Enter to create it. Cmd/Ctrl+P has no Nimrod default binding.

Other listed actions can be assigned shortcuts even if they have no default. Plus and Equals both invoke Zoom in. Existing user overrides remain unchanged when defaults change; Reset the affected action to adopt its new defaults.

**Delete opens the existing session-tree review; it does not immediately delete a session.** Its normal saved-session/idle eligibility rules still apply. Closing a saved session is not deletion. Temporary sessions use their existing Close/disposal flow.

Project actions pause while Settings, the command palette, a key recorder, or an extension dialog is open. Settings and zoom shortcuts remain available on the Settings page, but not through another dialog. Repeated keydowns and IME composition never execute these actions. Shortcuts target the visible session, not a session hidden by Unread.

## Configuration file

Only user overrides are stored in [settings.json](settings.md#files-and-synchronization):

```jsonc
{
  "keybindings": {
    "new": ["primary+n"],
    "temporary": ["primary+shift+n"],
    "model": ["primary+j"],
    "thinking": [] // Intentionally unbound
  }
}
```

On macOS, Command+Option shortcuts still identify the underlying letter/digit when Option produces a dead key or alternate symbol (for example, Option+N’s tilde). Matching and the recorder share this normalization. Plain Option typing and IME composition are not treated as application shortcuts. This fallback uses standard letter/digit key positions when the unmodified layout character is unavailable; alternate keyboard layouts still need native validation.

`primary` means Cmd on macOS and Ctrl on Linux. Explicit `cmd` and `ctrl` modifiers are also accepted. Modifier order is `primary`, `cmd`, `ctrl`, `alt`, `shift`, followed by the lowercase key. Use names such as `backspace`, `enter`, `arrowup`, or `plus`. Each action accepts up to eight single-keystroke shortcuts. Omitted actions inherit built-in defaults; an empty array disables the action’s shortcuts. Reset removes that action’s override; Reset all leaves an empty overrides object.

Valid external edits apply automatically. Conflicting file-authored shortcuts execute neither action and report a conflict; resolve them in the editor. Unknown action IDs are retained for compatibility, but cannot execute an action this build does not implement.

## Boundaries

This editor covers Nimrod’s project-shell actions and zoom, not Pi’s internal keymap, composer Send/Queue/Newline behavior, native text editing, or pop-out window shortcuts. Multi-step chords, macros, arbitrary context expressions, and per-project overrides are not included.

Native menu/text-editing keys such as Cmd/Ctrl+O, Q, H, A, C, V, X, Z and Tab combinations are reserved. On macOS, **Minimize** remains in the Window menu without Cmd+M, freeing that shortcut for Select model. **Close Window** remains available in the native menu without Cmd/Ctrl+W, which belongs to Close session. OS-reserved shortcuts can still be intercepted before Nimrod receives them.

Automated offline WebKit and fixture tests cover editing and focus/draft/disclosure preservation. Native menu delivery and keyboard-layout behavior still need macOS user validation; Linux support is intended but not platform-verified, and Windows remains a possible future target.
