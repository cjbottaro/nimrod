# Documentation

## Feature guides

- [Card plugins](card-plugins.md) — **planned** customizable cards, with built-in renderers using the same API as third-party plugins.

- [Transcript cards](architecture.md#rendering-contract-retained-from-pi-gui) — consistent tool summaries, invocation identity and disclosure behavior.

- [Notifications](notifications.md) — background-session desktop alerts, click-to-session/bottom navigation, preferences and native limitations.

- [Pop-outs](pop-outs.md) — keep code/Markdown visible; session visibility and persistence.
- [Projects and sessions](workspace-sessions.md) — native project menu and session management: opening, closing, [terminal launches and macOS window cycling](workspace-sessions.md#terminal-launches), [sidebar width](workspace-sessions.md#sidebar-width), [sidebar views, recency/time labels and blank attention surfaces](workspace-sessions.md#sidebar-views), [reload/restart](workspace-sessions.md#reload-restart-session), [delete session tree](workspace-sessions.md#delete-session-tree), saved sessions and drafts.
- [Settings](settings.md) — appearance, runtime paths and configuration files.
- [Keybindings](keybindings.md) — searchable shortcut editor, conflict reassignment and reset to defaults.
- [Themes](themes.md) — built-in themes and importing color schemes.

## Project references

- [Architecture](architecture.md) — boundaries and behavior contracts.
- [Verification](verification.md) — tested behavior and remaining native/platform checks.
- [Build cache](build-cache.md) — mise-managed Rust compiler caching shared across main and worktrees, with separate app artifacts.
- [Theme catalog plan](theme-catalog-plan.md) — proposed work, not shipped behavior.

Detailed implementation references are indexed by the repository's
[features skill](../.agents/skills/features/SKILL.md); guides here focus on usage and observable behavior.
