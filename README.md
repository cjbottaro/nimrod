# Nimrod ✦

A dedicated cross-platform app for directory-backed coding projects and agent sessions. Conversations belong here; files, searches and diffs stay in your editor.

**One project directory per window, with bespoke harness integrations.** Pi is primary, using your installed Pi and its configuration, extensions, models and authentication. Built-in [Copilot](docs/copilot.md) uses the bundled official SDK with your installed/authenticated CLI. [Codex](docs/codex.md) uses your installed CLI's native app-server; installed-runtime/native acceptance is pending. Generic ACP infrastructure is retained internally for possible future harnesses, without creation/options UI. SDK fixtures, packaging and real-agent/native acceptance are pending.

## Get started

For packaged macOS releases, see [Installation](docs/installation.md): signed/notarized Apple Silicon DMGs (no Intel downloads), plus `brew install --cask cjbottaro/tap/nimrod` once the first stable release and tap are published. The release pipeline is implemented; first-run distribution acceptance is pending.

For development, Rust, Node and sccache are pinned through mise:

```sh
mise trust
mise install
npm ci
mise run dev
```

macOS needs Xcode Command Line Tools; other platforms need [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).
For checks and explicitly requested packaged builds, see [Contributing](CONTRIBUTING.md). [Changelog](CHANGELOG.md) tracks notable changes; Unreleased can be ahead of public downloads. Local development builds do not require version bumps or release tags.

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
- [Codex sessions](docs/codex.md) — native app-server, explicit create/Resume, project history, drafts, text steering/Stop, image input, approvals, result-confirmed model/effort controls and reviewed spawned-thread tree deletion; native acceptance pending.
- [Copilot sessions](docs/copilot.md) — official SDK, separate saved identity/drafts, history/Resume, pasted images, permissions, model/thinking, estimated USD/AIC and compact context usage, supported permanent deletion and [harness-owned slash commands](docs/copilot.md#slash-commands) with argument suggestions and modal choices.
- [Session sidebar](docs/session-sidebar.md) — pinning, native session-row menus, All/Unread/Working views, activity indicators and resizing.
- [Drafts](docs/drafts.md) — native per-session storage, debounced saves and recovery.
- [Writing messages](docs/writing-messages.md) — send, steer, queue, Stop, slash commands and recovery. [Error messages](docs/error-messages.md) describes session-local notices and the application notice strip.
- [Reading conversations](docs/reading-conversations.md) — operation cards, tool/reasoning cards, code actions, links and auto-follow.
- [Paste images](docs/image-paste.md) — image attachments and delivery behavior.
- [Session configuration](docs/model-thinking.md) — change supported model, thinking, mode and context-window settings during work, plus [Copilot live permission policy](docs/copilot.md#change-permissions-during-work).
- [Pop-outs](docs/pop-outs.md) — persistent reference windows for code and rendered Markdown.
- [Notifications](docs/notifications.md) — background-session alerts and delivery troubleshooting.
- [MCP inspector](docs/mcp.md) — read-only session server status, exposure, counts and reported errors.
- [Command palette](docs/command-palette.md) and [Keybindings](docs/keybindings.md) — searchable commands and customizable shortcuts.
- [Performance reports](docs/performance-diagnostics.md) — opt-in local timing captures for sluggish typing/scrolling.
- [Transcript debug logs](docs/transcript-logs.md) — opt-in full-content native conversation, history, tool and request/result traces for developing/debugging Nimrod.
- [Settings](docs/settings.md) — global defaults, project overrides, appearance, [conversation/code fonts and sizes](docs/settings.md#typography), zoom and runtime paths.
- [Themes](docs/themes.md) and [Syntax highlighting](docs/syntax-highlighting.md) — bundled palettes, local imports and labeled code.
- [Translucency](docs/translucency.md) — whole-window background opacity and independently adjustable macOS blur; Linux blur is compositor-owned.

See the [user-guide index](docs/README.md). [Card plugins](docs/card-plugins.md) power bundled cards, requested-edit previews and automatically loaded/cached personal TypeScript tool customization (with compiled-JS compatibility). Use the [built-in card cookbook](docs/builtin-card-cookbook.md) for real-session prompts and expected presentations. See [plugin authoring](docs/card-plugin-api.md) for the mounted DOM API, or try the optional [Pi Web Access cards](docs/pi-web-access-plugin.md).

## Platform status and limitations

macOS is the current development platform; Linux is next, and Windows is a possible future target, not a parity commitment. Linux native delivery/focus and Windows behavior remain unverified. The Bash launcher has no Windows wrapper; Windows Pi npm `.cmd` wrappers are not supported (select Pi's JS entry point and `node.exe` explicitly).

There is no background process continuity, integrated diff editor, fork/tree-navigation UI, Pi `/reload` or in-app update system. [Built-in Copilot](docs/copilot.md) uses SDK 1.0.22 (declared CLI 1.0.98 compatibility), a supported installed Node and an explicitly resolved user-installed CLI—not a bundled CLI. Copilot identities/drafts persist with exact-ID Resume and permanent deletion. The earlier Copilot integration is removed; old stored drafts are not migrated or deleted. SDK checks, packaging and native macOS/Linux acceptance remain pending; Windows SDK launch is unavailable. SDK/ACP Restart and ACP attachment sending remain unavailable; Copilot supports inline image input with installed-CLI/native acceptance pending; generic ACP infrastructure is not exposed in the UI. macOS local bundles use ad-hoc signing; the separate [release workflow](CONTRIBUTING.md#release-setup) uses Developer ID signing/notarization and DMG packaging. Opening a project never loads Copilot automatically; explicit selection reconnects without sending a prompt. Closing a project stops its owned agents.

Send clears the composer and previews ordinary messages in the transcript immediately (images after local preparation), then reconciles the harness's user turn in place. Failed or uncertain sends show an error without restoring the message or blocking a new draft; nothing is automatically replayed. Pi owns conversation history; Nimrod cannot coordinate external applications writing the same session file.

## License

Copyright (c) 2026 Christopher J. Bottaro.

Nimrod is free software licensed under the **GNU Affero General Public License,
version 3 only** (`AGPL-3.0-only`). You may use, modify and redistribute it under
the terms in [LICENSE](LICENSE). Nimrod is provided without warranty.

Third-party components retain their respective licenses; see
[Third-party notices](THIRD_PARTY_NOTICES.md) and
[Theme catalog notices](THEME_CATALOG_NOTICES.md).

Earlier revisions made available under MIT remain available under those terms;
this license change does not revoke previously granted permissions.
