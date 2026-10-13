---
name: features
description: Nimrod feature specifications and implementation guidance. Load for design, implementation, debugging, review or documentation; use the index to read only relevant references.
---

# Nimrod features

Read repository `AGENTS.md`, [architecture](references/architecture.md) and the relevant references below before changes. For UI work, load the [shared vocabulary](../nimrod-ui-vocabulary/SKILL.md). Implement directly unless delegation is approved.

When adding or changing error paths, notices, banners, flash messages or operational notifications, load the [error presentation policy](references/error-presentation.md). It owns ownership-based placement (session conversation notices versus the application notice strip), shared routing, wording, deduplication and lifecycle. Do not invent additional error surfaces.

## Interaction policy

Apply the [optimistic interaction policy](references/architecture.md#optimistic-interaction-policy) to all UI work: local user actions drive immediate feedback; RPC success is not a general UI gate. Late errors annotate the affected operation, and authoritative harness events reconcile data without replay, draft restoration or repeat navigation. Any result-gated exception must have a concrete authoritative-state or destructive-operation requirement documented in its feature reference.

## Feature index

References own specifications, acceptance criteria, code maps, state/lifecycle, invariants and tests. Labels below route work; they do not duplicate specifications.

| Work area | Canonical reference | User guide |
| --- | --- | --- |
| Project identity, recent projects, session lifecycle and draft storage | [Projects/sessions](references/projects-and-sessions.md) | [Projects](../../../docs/projects.md), [Sessions](../../../docs/sessions.md) |
| Ordering, activation, connection and cleanup selection | [Session navigation](references/session-navigation.md) | [Sidebar navigation](../../../docs/session-sidebar.md#ordering-and-navigation) |
| All/Unread/Working membership, indicators and recency | [Sidebar views](references/sidebar-attention.md) | [Session sidebar](../../../docs/session-sidebar.md) |
| Shared sidebar resize mechanics | [Sidebar resizing](references/sidebar-resize.md) | [Resize](../../../docs/session-sidebar.md#resize) |
| Deletion preview, transactions, reconciliation and recovery | [Session deletion](references/session-deletion.md) | [Deletion](../../../docs/sessions.md#delete-session-tree) |
| CLI forwarding and native instance ownership | [Single instance](references/single-instance.md) | [Terminal launches](../../../docs/projects.md#terminal-launches) |
| Session-local notices and window/application strip, routing, deduplication, wording and lifecycle | [Error presentation](references/error-presentation.md) | [Error messages](../../../docs/error-messages.md) |
| Pi framing, response order and result correlation | [Pi transport](references/pi-transport.md) | [Writing messages](../../../docs/writing-messages.md) |
| Native per-session drafts, debounced saves and submission durability | [Native drafts](references/native-drafts.md) | [Drafts](../../../docs/drafts.md) |
| Send/steer/queue, pending turns and recovery | [Composer](references/composer.md) | [Writing messages](../../../docs/writing-messages.md) |
| Image paste, draft bytes and send outcomes | [Image paste](references/image-paste.md) | [Paste images](../../../docs/image-paste.md) |
| Tool/reasoning identity, lifecycle and disclosures | [Transcript cards](references/transcript-cards.md) | [Reading conversations](../../../docs/reading-conversations.md) |
| Transcript layout, scroll intent, focus and zoom | [Transcript interaction](references/transcript-interaction.md) | [Reading](../../../docs/reading-conversations.md), [Settings](../../../docs/settings.md) |
| Explicit labels and user-code inference | [Syntax highlighting](references/syntax-highlighting.md) | [Syntax highlighting](../../../docs/syntax-highlighting.md) |
| Snapshot storage, visibility and native reference focus | [Pop-outs](references/pop-outs.md) | [Pop-outs](../../../docs/pop-outs.md) |
| Background alerts, previews and native click routing | [Notifications](references/notifications.md) | [Notifications](../../../docs/notifications.md) |
| Live model/thinking configuration | [Model/thinking](references/model-thinking.md) | [Model/thinking](../../../docs/model-thinking.md) |
| Global defaults, project JSONC overrides, migration and window state | [Preferences](references/preferences.md) | [Settings](../../../docs/settings.md) |
| Global Settings window, Project settings page, categories and independent width | [Settings layout](references/settings-layout.md) | [Settings](../../../docs/settings.md) |
| Bindable actions, recorder and conflicts | [Keybindings](references/keybindings.md) | [Keybindings](../../../docs/keybindings.md) |
| Read-only built-in Pi MCP status inspection | [MCP inspector](references/mcp-inspector.md) | [MCP inspector](../../../docs/mcp.md) |
| Palette page lifecycle and cancellation | [Command interactions](references/command-interactions.md) | [Command palette](../../../docs/command-palette.md) |
| Palette command ranking and usage storage | [Command ranking](references/command-ranking.md) | [Ordering](../../../docs/command-palette.md#ordering) |
| Shared modal shell and action focus | [Modal layout](references/modal-layout.md) | [Confirmations](../../../docs/command-palette.md#confirmation-dialogs) |
| Opt-in timing history, explicit local capture and bounded report storage | [Performance diagnostics](references/performance-diagnostics.md) | [Performance reports](../../../docs/performance-diagnostics.md) |
| Completed performance work, rationale/results and potential future optimizations (catalogue, not replacement feature contracts) | [Performance optimizations skill](../performance-optimizations/SKILL.md) | Agent-facing only |
| Shared window creation/focus, presentation readiness/lifetime and explicit theme propagation | [Window presentation](references/window-presentation.md) | [Settings](../../../docs/settings.md), [Translucency](../../../docs/translucency.md) |
| Window opacity, continuous surface hierarchy, native/compositor blur and accessibility | [Translucency](references/translucency.md) | [Translucency](../../../docs/translucency.md) |
| Theme selection, preview, import and synchronization | [Themes](references/themes.md) | [Themes](../../../docs/themes.md) |
| Theme-catalog maintenance and pinned sources | [Theme catalog](references/theme-catalog.md) | [Contributing](../../../CONTRIBUTING.md) |
| Explicit builds, publication and compiler cache | [Build workflow](references/build-cache.md) | [Contributing](../../../CONTRIBUTING.md#app-builds) |
| Optional external renderer for Pi web search/fetch/stored content/source check | [Pi Web Access cards](references/pi-web-access-plugin.md) | [Pi Web Access cards](../../../docs/pi-web-access-plugin.md) |
| Mounted DOM renderers, cached personal TypeScript discovery/reload and legacy packages | [Card plugins](references/card-plugins.md) | [Card plugins](../../../docs/card-plugins.md), [Authoring](../../../docs/card-plugin-api.md) |

## Workflow and documentation

- Follow repository `AGENTS.md`: use a dedicated task worktree, automatically commit and merge completed significant work into `main`, and retain the branch/worktree unless cleanup is requested. Cleanup means removing both the task worktree and its local branch after confirming the branch is merged into `main` and the worktree has no uncommitted changes; never force deletion. Do not run tests, checks or builds unless explicitly requested. When validation is requested, use `mise run check` and include offline browser tests for scrolling changes. No automatic user-app launch/interruption; [build workflow](references/build-cache.md) owns requested publication.
- When feature work touches persistence, draft input, transcript/cards, session activation, sidebar projections or output-scroll/history layout, consult the relevant [performance optimization regression guardrails](../performance-optimizations/SKILL.md#maintaining-and-using-the-catalogue), not only when explicitly optimizing. They identify shared paths to reuse and fixture-extension triggers; this skill's feature references remain authoritative.
- Keep tests fixture-based. No paid requests, live compaction, user-session deletion or upstream extension changes without authorization.
- Every palette command must have a registered bindable action and shared dispatcher; empty defaults are allowed. Effective shortcut hints come from the registry. Native-only Open project remains an explicit exception. See [keybindings](references/keybindings.md#invariants).
- `docs/` is user-facing usage, observable behavior and relevant limitations. References are internal specifications/implementation. Behavior changes update both; implementation-only changes update the reference.
- Keep one canonical owner for shared contracts; other features link to it. The vocabulary skill owns names, not lifecycle specifications.
- New references belong in this index; new user guides belong in [docs index](../../../docs/README.md) and README. Developer tooling belongs in Contributing, not an app feature guide.
- Keep living references focused on current contracts/test maps. Archive significant superseded investigations in `references/history/` with clear historical status. [Verification](references/verification.md) owns current native evidence boundaries and acceptance gaps; fixture tests never establish native parity.
- Documentation links/anchors are checked offline by `npm run check:docs`, included in `mise run check`. The checker ignores fenced examples and never fetches external URLs.
