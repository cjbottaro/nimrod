# Nimrod ✦

A dedicated cross-platform app for directory-backed coding projects and agent sessions. Conversations belong here; files, searches and diffs stay in your editor.

**One project directory per window, with bespoke harness integrations.** Pi is the first and only implemented integration. Nimrod uses your installed Pi and its configuration, extensions, models and authentication.

## Get started

This proof of concept runs from a local checkout. Rust, Node and sccache are pinned through mise:

```sh
mise trust
mise install
npm ci
mise run dev
```

macOS needs Xcode Command Line Tools; other platforms need [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).
For checks and explicitly requested packaged builds, see [Contributing](CONTRIBUTING.md).

1. Open a project directory.
2. Choose **New session**, or open **⌘/Ctrl Shift+P → Resume session…** for saved project history.
3. Write in the composer and press **Enter**. Use **Shift+Enter** for a newline.
4. Start another session with **⌘/Ctrl+N**; switch with **⌘/Ctrl+T** or the Session sidebar.

Starting Pi uses the project's normal Pi trust policy. Sending a prompt is real provider work; Pi's startup `--offline` flag does not disable model requests. Override executable paths in **Settings → Runtime** if discovery fails.

## Terminal launcher

After packaging the app, install the launcher from the primary checkout:

```sh
mise run install-cli       # creates ~/.local/bin/nimrod; does not edit your shell
nimrod .
nimrod ~/Projects/another-project
```

Without installation, use `./bin/nimrod .`. The launcher opens or focuses a project window; it never starts or resumes a session. It supports macOS and Linux. See [Projects and terminal launches](docs/projects.md).

## Features

- [Projects](docs/projects.md) — directory-backed windows and recent-project navigation.
- [Sessions](docs/sessions.md) — persistent and temporary conversations, resume, restart, close and deletion.
- [Session sidebar](docs/session-sidebar.md) — All, Unread and Working views, activity indicators and resizing.
- [Drafts](docs/drafts.md) — native per-session storage, debounced saves and recovery.
- [Writing messages](docs/writing-messages.md) — send, steer, queue, Stop, slash commands and recovery.
- [Reading conversations](docs/reading-conversations.md) — tool/reasoning cards, code actions, links and auto-follow.
- [Paste images](docs/image-paste.md) — image attachments and image-send recovery.
- [Model and thinking preferences](docs/model-thinking.md) — change upcoming-request configuration during work.
- [Pop-outs](docs/pop-outs.md) — persistent reference windows for code and rendered Markdown.
- [Notifications](docs/notifications.md) — background-session alerts and delivery troubleshooting.
- [Command palette](docs/command-palette.md) and [Keybindings](docs/keybindings.md) — searchable commands and customizable shortcuts.
- [Settings](docs/settings.md) — appearance, zoom, runtime paths and local configuration.
- [Themes](docs/themes.md) and [Syntax highlighting](docs/syntax-highlighting.md) — bundled palettes, local imports and labeled code.

See the [user-guide index](docs/README.md). [Card plugins](docs/card-plugins.md) power bundled cards; external plugins are planned.

## Platform status and limitations

macOS is the current development platform; Linux is next, and Windows is a possible future target, not a parity commitment. Linux native delivery/focus and Windows behavior remain unverified. The Bash launcher has no Windows wrapper; Windows Pi npm `.cmd` wrappers are not supported (select Pi's JS entry point and `node.exe` explicitly).

There is no background process continuity, integrated diff editor, fork/tree-navigation UI, Pi `/reload`, other harness integration, automatic update system or production installer. macOS local bundles use ad-hoc signing, not Developer ID signing/notarization. Opening a project does not start Pi; selecting an inactive saved session loads and reconnects it without sending a prompt. Closing a project stops its owned agents.

Nimrod preserves drafts on rejected or uncertain sends and never automatically replays a prompt. Pi owns conversation history; Nimrod cannot coordinate external applications writing the same session file.
