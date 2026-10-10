# Documentation

## Feature guides

- [Card plugins](card-plugins.md) — **planned** customizable cards, with built-in renderers using the same API as third-party plugins.

- [Transcript cards](architecture.md#rendering-contract-retained-from-pi-gui) — consistent tool summaries, invocation identity and disclosure behavior.
- [Steering messages](architecture.md#steering-messages) — immediate pending user turns, acknowledgement, consumption and recovery.

- [Notifications](notifications.md) — background-session desktop alerts, click-to-session/bottom navigation, preferences and native limitations.

- [Pop-outs](pop-outs.md) — keep code/Markdown visible; session visibility and persistence.
- [Projects and sessions](workspace-sessions.md) — [searchable recent-project picker and native folder chooser](workspace-sessions.md#projects), plus session management: opening, closing, [consistent sidebar/Switch/shortcut navigation](workspace-sessions.md#session-navigation), connected-first cleanup selection with replacement loading/reconnect, [terminal launches and macOS window cycling](workspace-sessions.md#terminal-launches), [command cancellation and Back](workspace-sessions.md#command-interactions), [sidebar width](workspace-sessions.md#sidebar-width), [sidebar views, recency/time labels and blank attention surfaces](workspace-sessions.md#sidebar-views), [reload/restart](workspace-sessions.md#reload-restart-session), [delete session tree](workspace-sessions.md#delete-session-tree), saved sessions and drafts.
- [Model and thinking preferences](model-thinking.md) — change selections during work; upcoming-request behavior and acknowledged state.
- [Command palette](command-palette.md) — descriptive rows, right-aligned shortcuts, recent-first commands and shared history.
- [Modal layout](modal-layout.md) — shared dialog shell, content boundaries and full-window Settings exception.
- [Settings](settings.md) — category navigation, shared sidebar resizing with independent app-wide width, appearance, notifications, keybindings, runtime paths and configuration files.
- [Keybindings](keybindings.md) — searchable shortcut editor, conflict reassignment and reset to defaults.
- [Themes](themes.md) — built-in themes and importing color schemes.

## Project references

- [Architecture](architecture.md) — boundaries and behavior contracts.
- [Verification](verification.md) — tested behavior and remaining native/platform checks.
- [Build cache](build-cache.md) — mise-managed Rust compiler caching shared across main and worktrees, with separate app artifacts.
- [Theme catalog plan](theme-catalog-plan.md) — proposed work, not shipped behavior.

Detailed implementation references are indexed by the repository's
[features skill](../.agents/skills/features/SKILL.md); guides here focus on usage and observable behavior.
