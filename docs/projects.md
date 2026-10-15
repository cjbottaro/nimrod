# Projects

A project is a directory—no Git repository, manifest or registration required. One directory belongs to each window and is the working directory of all sessions in that window. A nested worktree with a different working directory needs its own project window.

The **Project bar** shows the directory name and parent path. Home is abbreviated to `~`; hover for the full path. The displayed session’s name follows the path after a muted middle dot, even when the Session sidebar is collapsed. It uses the same label as the sidebar (including unnamed and temporary sessions); long names truncate, with the full label available on hover. When no conversation is displayed, the session label and dot are hidden.

## Open a project

1. Use **File → Open project…** (**⌘/Ctrl+O**) or the welcome screen's directory chooser.
2. Choose a directory.
3. Choose **New session** or **Resume session…** when ready to open a conversation.

Opening a project never starts Pi. Opening an already-open directory brings its window forward; another directory opens another window. Closing a project window stops only its owned agents, leaving other projects running.

## Open a recent project

Use **Open recent project…** from the command palette or File menu, or **⌘/Ctrl+Shift+O**.

Type a directory name or path, then press Enter or click a row. A **•** means the project already has a window; it does not mean it has saved sessions. Escape cancels. To browse a new directory, use **Open project…** instead.

Recents remember opened directories, including empty directories and home. There is no Remove from recents action yet. Missing or moved directories show an error rather than substituting another directory. An empty Session sidebar means no open sessions; use **Resume session…** to look for closed history.

## Terminal launches

A [Homebrew installation](installation.md#homebrew) includes the launcher and uses the installed app. For a development build, package the app and install the launcher from your primary checkout:

```sh
mise run install-cli            # ~/.local/bin/nimrod
nimrod .                       # terminal's current directory
nimrod /path/to/project
nimrod --help
```

Ensure `~/.local/bin` is on PATH. Without installation, use `./bin/nimrod .`. A different installation directory can be passed to `bash scripts/install-cli.sh /your/bin`; installation refuses to overwrite another command and does not edit shell configuration.

The development launcher uses that checkout's packaged app; the Homebrew/packaged launcher resolves its own containing app, including a custom Applications directory. Set `NIMROD_APP=/Applications/Nimrod.app` for another macOS bundle, or a Linux executable path for another Linux build. No Windows terminal wrapper is included.

Terminal launches open/focus projects without starting or resuming agents. Rapid macOS launches are intended to share one app instance. The command returns on OS launch acceptance, not a window-focus acknowledgement; later routing errors appear in the app.

**Quit the old build before trying a new build.** Launches forward to an already-running Nimrod, which keeps its old code. On macOS, **⌘+backtick** cycles project windows and skips pop-outs; this native shortcut is separate from session switching and isn't customizable in Nimrod.

Native macOS launch forwarding/window cycling and Linux launcher behavior still need platform acceptance.

See [Sessions](sessions.md) for conversations and [Keybindings](keybindings.md) to customize recent-project navigation.
