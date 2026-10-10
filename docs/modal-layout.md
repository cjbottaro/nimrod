# Modal layout

Nimrod's ordinary dialogs share the command palette's width, upper-window placement, outer padding, border, corner radius, shadow and backdrop. Confirmation/input/select dialogs, deletion review, the keybinding recorder and Pi's text editor use the same shell. The named-session step keeps the same width as other palette pages.

Headers, content spacing and action footers share common styling. Content still fits its purpose: command rows have descriptions and shortcuts, session rows have timestamps and indicators, and deletion review has a scrollable tree. Sharing the shell does not make these content layouts identical.

Confirmation dialogs focus their action on opening: **Close temporary session**, **Close session**, **Restart session**, **Delete N sessions**, or **Reset**. The action carries an Enter icon; Cancel carries an Esc hint. Enter activates the action unless you move focus to Cancel, where Enter cancels. Escape always cancels. Pi extension confirmations retain the generic Confirm label; input/select and shortcut-recording dialogs retain their editing behavior.

Deletion previews initially focus Cancel while loading, with Delete disabled. If loading is already visible when the tree arrives, focus stays where you left it; Enter on Cancel still cancels. Tab to Delete or click it to proceed.

Settings is intentionally a full-window page, not a floating dialog. Native OS file/directory choosers remain OS-controlled.

Offline WebKit tests cover shared shell styling at desktop/narrow viewport sizes and propagation of shared layout changes. Native app visual acceptance and Linux/Windows verification remain pending.
