# Modal layout

Nimrod's ordinary dialogs share the command palette's width, upper-window placement, outer padding, border, corner radius, shadow and backdrop. Confirmation/input/select dialogs, deletion review, the keybinding recorder and Pi's text editor use the same shell. The named-session step keeps the same width as other palette pages.

Headers, content spacing and action footers share common styling. Content still fits its purpose: command rows have descriptions and shortcuts, session rows have timestamps and indicators, and deletion review has a scrollable tree. Sharing the shell does not make these content layouts identical.

Settings is intentionally a full-window page, not a floating dialog. Native OS file/directory choosers remain OS-controlled.

Offline WebKit tests cover shared shell styling at desktop/narrow viewport sizes and propagation of shared layout changes. Native app visual acceptance and Linux/Windows verification remain pending.
