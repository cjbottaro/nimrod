---
name: features
description: Nimrod feature specifications and implementation guidance. Load for design, implementation, debugging, review, documentation, changelog maintenance or release preparation; use the index to read only relevant references.
---

# Nimrod features

Read repository `AGENTS.md`, [architecture](references/architecture.md) and the relevant references below before changes. For UI work, load the [shared vocabulary](../nimrod-ui-vocabulary/SKILL.md). Implement directly unless delegation is approved.

When adding or changing error paths, notices, banners, flash messages or operational notifications, load the [error presentation policy](references/error-presentation.md). It owns ownership-based placement (session conversation notices versus the application notice strip), shared routing, wording, deduplication and lifecycle. Do not invent additional error surfaces.

When designing or reviewing pending agent decisions (including permission requests and agent questions), follow the [dismiss-and-resume workflow](references/dismiss-and-resume.md): modal dismissal is separate from request settlement; use a persistent session-local pending-action banner to reopen supported pending interactions.

When adding or changing a modal, dialog, picker or preview, load the [modal implementation checklist](references/modal-layout.md#implementation-checklist). Ordinary modals **must** use the shared shell and `src/modal-motion.ts` lifecycle helpers (or an existing component that uses them), not raw dialog methods or custom open/close animations. Full-window Settings and native OS choosers are explicit exceptions documented there. Shared styling alone does not wire all motion paths.

When adding or changing Settings sliders, follow [shared range inputs](references/settings-layout.md#range-inputs): use the shared track styling and initialize/update fill after programmatic value changes, not only after user input. Never dispatch fake input/change events to force initial paint.

## Interaction policy

Apply the [optimistic interaction policy](references/architecture.md#optimistic-interaction-policy) to all UI work: local user actions drive immediate feedback; RPC success is not a general UI gate. Late errors annotate the affected operation, and authoritative harness events reconcile data without replay, draft restoration or repeat navigation. Any result-gated exception must have a concrete authoritative-state or destructive-operation requirement documented in its feature reference.

## Harness integration direction

**Curated harnesses are bespoke-first: Pi native RPC and built-in [Copilot SDK](references/copilot-sdk.md).** The SDK migration is source-implemented with authored fixtures **unrun**; installed-CLI, packaging and native acceptance remain pending. [Generic ACP](references/acp-harnesses.md) is retained as dormant protocol/adapter infrastructure for future harnesses, without current creation/options UI. The Copilot-specific ACP integration is removed; old draft files are retained without migration. Its historical POC worktree/abandonment strategy does not govern this separate SDK task.

**Product scope is Pi-first, not universal harness parity.** Build a small curated set of bespoke integrations plus a capability-driven generic ACP baseline; the [target portfolio and scope rules](references/harness-presentation.md#target-portfolio-and-scope) distinguish intended experience from implemented support. Use supported ACP/SDK/native interfaces where practical. Omit inaccessible capabilities rather than reverse-engineering or emulating them; expose cross-harness equivalents only where their actual semantics make sense. Experience tiers describe richness and polish, never weaker correctness or ownership guarantees. Harness identity is separate from its integration mechanism; Nimrod owns integration correctness, while card plugins enhance presentation.

**Use small, consumer-oriented internal interfaces:** shared contracts describe what a Nimrod consumer needs, while concrete integrations retain protocol and lifecycle meaning. Follow [consumer-oriented interfaces](references/consumer-interfaces.md) for the current lifecycle split, candidate inventory, definition checklist and remaining shell-extraction work. Do not replace bespoke integrations with a universal controller, or treat adding an interface as completing responsibility extraction.

Session backends are immutable; model/thinking changes never switch harnesses. Preserve bespoke harness functionality behind a shared transcript/plugin runtime and one Nimrod-owned command palette. Plugin sets may be harness/agent-specific, but shared UI components must be public and dogfooded equally by bundled and external plugins; see the [plugin boundary](references/card-plugins.md#multi-harness-plugin-boundary). [Harness presentation](references/harness-presentation.md) owns the internal interaction/control/action contributions and rationale; these are distinct from public card-content plugins.

Generic ACP is not the ceiling or mandatory route for curated harnesses. Use supported bespoke SDK/native interfaces for concrete lifecycle/history, configuration and tool benefits; Copilot now uses the pinned released SDK. Extract shared consumer boundaries from concrete integrations rather than inventing a universal harness framework.

Each bespoke backend is an alternative controller for that harness, not a second concurrent controller of the same live session. Do not promise seamless ACP/SDK switching until session identity, history, configuration and ownership interoperability are verified. Harnesses remain authoritative, and controls must reflect actual capabilities rather than approximating Pi semantics.

## Changelog and release policy

For requests to generate, prepare, cut, ship, publish or retry a release, load the dedicated [release skill](../release/SKILL.md). It requires a concrete version/source/changelog/platform/validation preview and a subsequent explicit approval before release metadata edits, tags or publication. Ordinary task commit/merge authorization does not bypass that gate.

For every task, assess user-visible impact before completion. Meaningful implemented features, behavior changes, fixes, removals, compatibility or installation changes update the root [CHANGELOG.md](../../../CHANGELOG.md) under **Unreleased**, in the same commit as the implementation. Otherwise explicitly report why no changelog entry is warranted. Pure refactors, test maintenance, routine documentation and policy-only changes normally need no entry.

Unreleased is a curated description of the final behavior, not an agent activity log: consolidate related iterations, preserve other tasks' entries and never rewrite published history. Follow the canonical [development/changelog policy](references/releases.md#development-and-changelog-policy) for categories, breaking changes, release preparation and prerelease snapshots.

Rapid local development: merge task branches into main and build only when requested. Local merges/builds need no version bump, tag or release; the Git revision/dirty metadata distinguishes builds. Changelog maintenance grants no additional permission to run tests/builds, tag, push or publish. Repository workflow and validation rules are owned by `AGENTS.md`.

## Feature index

References own specifications, acceptance criteria, code maps, state/lifecycle, invariants and tests. Labels below route work; they do not duplicate specifications.

| Work area | Canonical reference | User guide |
| --- | --- | --- |
| Built-in Copilot SDK, runtime/process ownership, identity/legacy policy and SDK semantics | [Copilot SDK](references/copilot-sdk.md) | [Copilot](../../../docs/copilot.md) |
| Finish Plan/Autopilot support: controlled acceptance, distinct-model handoffs and compaction confirmation gaps | [Copilot mode acceptance skill](../copilot-mode-acceptance/SKILL.md) | [Plan and Autopilot](../../../docs/copilot.md#plan-and-autopilot) |
| Copilot scope-labelled approval choices, sequential permission picker, nested feedback and Review requests banner | [Copilot permissions](references/copilot-sdk.md#permission-choices-and-interaction) | [Permissions](../../../docs/copilot.md#permissions-and-questions) |
| Copilot Question picker, nested custom answers and pending-question banner | [Copilot questions](references/copilot-sdk.md#questions-and-custom-answers) | [Questions](../../../docs/copilot.md#permissions-and-questions) |
| Copilot reported AIC/estimated USD, compact context utilization and optional metadata lifetime | [Copilot usage metrics](references/copilot-sdk.md#usage-metrics) | [Copilot usage](../../../docs/copilot.md#usage-metrics) |
| Slash-command ownership, lifecycle, generic result handling, reconciliation, audits and adapter criteria | [Slash commands skill](../slash-commands/SKILL.md), [shared ownership](references/harness-presentation.md#harness-command-ownership) | Integration-specific user guides |
| Copilot command discovery, argument suggestions, harness-owned modal choices and command output | [Copilot slash commands](references/copilot-commands.md) | [Copilot commands](../../../docs/copilot.md#slash-commands) |
| Project identity, recent projects, session lifecycle and draft storage | [Projects/sessions](references/projects-and-sessions.md) | [Projects](../../../docs/projects.md), [Sessions](../../../docs/sessions.md) |
| Ordering, pinning, native row menus, activation, connection and cleanup selection | [Session navigation](references/session-navigation.md) | [Sidebar navigation](../../../docs/session-sidebar.md#ordering-and-navigation) |
| Shared session-list/status contract and Pi/Copilot saved-history discovery | [Session history](references/session-history.md) | [Sessions](../../../docs/sessions.md#switch-or-resume), [Copilot history](../../../docs/copilot.md#history-close-and-delete) |
| All/Unread/Working membership, indicators, recency and [sidebar scroll intent](references/sidebar-attention.md#sidebar-scroll-intent) | [Sidebar views](references/sidebar-attention.md) | [Session sidebar](../../../docs/session-sidebar.md) |
| Shared sidebar resize mechanics | [Sidebar resizing](references/sidebar-resize.md) | [Resize](../../../docs/session-sidebar.md#resize) |
| Shared deletion coordinator, Pi tree transactions, Copilot deletion and recovery | [Session deletion](references/session-deletion.md) | [Deletion](../../../docs/sessions.md#delete-session-tree), [Copilot deletion](../../../docs/copilot.md#history-close-and-delete) |
| CLI forwarding and native instance ownership | [Single instance](references/single-instance.md) | [Terminal launches](../../../docs/projects.md#terminal-launches) |
| Session-local notices and window/application strip, routing, deduplication, wording and lifecycle | [Error presentation](references/error-presentation.md) | [Error messages](../../../docs/error-messages.md) |
| Pi framing, response order and result correlation | [Pi transport](references/pi-transport.md) | [Writing messages](../../../docs/writing-messages.md) |
| Consumer-oriented interface direction, lifecycle contracts and candidate inventory | [Consumer interfaces](references/consumer-interfaces.md) | Internal architecture only |
| Shared presentation contracts, harness UI contributions and extraction rationale | [Harness presentation](references/harness-presentation.md) | [ACP sessions](../../../docs/acp.md), [Plugin authoring](../../../docs/card-plugin-api.md) |
| Retained internal ACP protocol/adapters and historical POC boundaries | [ACP harnesses](references/acp-harnesses.md) | [ACP sessions (POC)](../../../docs/acp.md) |
| Native per-session drafts, debounced saves and submission durability | [Native drafts](references/native-drafts.md) | [Drafts](../../../docs/drafts.md) |
| Send/steer/queue, pending turns and recovery | [Composer](references/composer.md) | [Writing messages](../../../docs/writing-messages.md) |
| Shared message-input interface, Pi/Copilot image paste, draft bytes and send outcomes | [Image paste](references/image-paste.md) | [Paste images](../../../docs/image-paste.md) |
| Operation-card title/content, pending stack, settlement, error details and optional cancellation | [Operation cards](references/operation-cards.md) | [Reading conversations](../../../docs/reading-conversations.md#operation-cards) |
| Completed Copilot question/answer transcript cards, separate from the Question picker | [Question/answer cards](references/card-plugins.md#copilot-questionanswer-cards) | [Reading questions and answers](../../../docs/reading-conversations.md#copilot-questionanswer-cards) |
| Tool/reasoning identity, lifecycle and disclosures | [Transcript cards](references/transcript-cards.md) | [Reading conversations](../../../docs/reading-conversations.md) |
| Transcript layout, scroll intent, focus and zoom | [Transcript interaction](references/transcript-interaction.md) | [Reading](../../../docs/reading-conversations.md), [Settings](../../../docs/settings.md) |
| Explicit labels and user-code inference | [Syntax highlighting](references/syntax-highlighting.md) | [Syntax highlighting](../../../docs/syntax-highlighting.md) |
| Snapshot storage, visibility and native reference focus | [Pop-outs](references/pop-outs.md) | [Pop-outs](../../../docs/pop-outs.md) |
| Background alerts, previews and native click routing | [Notifications](references/notifications.md) | [Notifications](../../../docs/notifications.md) |
| Capability-driven Status-area interface, Pi/SDK projections and keyed controls | [Status-area contract](references/harness-presentation.md#status-area-interface) | [Model/thinking](../../../docs/model-thinking.md) |
| Harness-contributed Set permissions command shortcuts and Copilot mapping | [Permission command shortcut](references/live-permissions.md) | [Copilot permission changes](../../../docs/copilot.md#change-permissions-during-work) |
| Session configuration interface, model/effort choices, deferred changes and local transcript progress | [Model/thinking](references/model-thinking.md) | [Model/thinking](../../../docs/model-thinking.md) |
| Global defaults, project JSONC overrides, migration and window state | [Preferences](references/preferences.md) | [Settings](../../../docs/settings.md) |
| Global Settings window, Project settings page, categories and independent width | [Settings layout](references/settings-layout.md) | [Settings](../../../docs/settings.md) |
| Global conversation/code font families and sizes, installed-font pickers, previews and content-only reflow | [Typography](references/typography.md) | [Typography settings](../../../docs/settings.md#typography) |
| Bindable actions, recorder and conflicts | [Keybindings](references/keybindings.md) | [Keybindings](../../../docs/keybindings.md) |
| Read-only built-in Pi MCP status inspection | [MCP inspector](references/mcp-inspector.md) | [MCP inspector](../../../docs/mcp.md) |
| Dismiss-and-resume: pending agent decisions, picker dismissal and banner reopening | [Dismiss-and-resume workflow](references/dismiss-and-resume.md) | [Copilot permissions and questions](../../../docs/copilot.md#permissions-and-questions) |
| Palette page lifecycle and cancellation | [Command interactions](references/command-interactions.md) | [Command palette](../../../docs/command-palette.md) |
| Palette command ranking and usage storage | [Command ranking](references/command-ranking.md) | [Ordering](../../../docs/command-palette.md#ordering) |
| Shared modal shell, configurable motion and action focus | [Modal layout](references/modal-layout.md) | [Confirmations](../../../docs/command-palette.md#confirmation-dialogs) |
| Transcript logging | [Transcript debug logging](references/transcript-logs.md) | [Transcript debug logs](../../../docs/transcript-logs.md) |
| Opt-in timing history, explicit local capture and bounded report storage | [Performance diagnostics](references/performance-diagnostics.md) | [Performance reports](../../../docs/performance-diagnostics.md) |
| Completed performance work, rationale/results and potential future optimizations (catalogue, not replacement feature contracts) | [Performance optimizations skill](../performance-optimizations/SKILL.md) | Agent-facing only |
| Shared window creation/focus, presentation readiness/lifetime and explicit theme propagation | [Window presentation](references/window-presentation.md) | [Settings](../../../docs/settings.md), [Translucency](../../../docs/translucency.md) |
| Independent window opacity/macOS blur, continuous surface hierarchy and accessibility | [Translucency](references/translucency.md) | [Translucency](../../../docs/translucency.md) |
| macOS blur-enable flash: end-to-end investigation, failed approaches and solution history | [Blur case study](references/history/macos-blur-enablement.md) | [Translucency](../../../docs/translucency.md) |
| Theme selection, preview, import and synchronization | [Themes](references/themes.md) | [Themes](../../../docs/themes.md) |
| Theme-catalog maintenance and pinned sources | [Theme catalog](references/theme-catalog.md) | [Contributing](../../../CONTRIBUTING.md) |
| Changelog maintenance, rapid local development and release preparation | [Development/changelog policy](references/releases.md#development-and-changelog-policy) | [Changelog](../../../CHANGELOG.md), [Contributing](../../../CONTRIBUTING.md#changelog-and-local-development) |
| Agent-assisted release proposals, mandatory preview/approval and scoped publication | [Release skill](../release/SKILL.md), [approval contract](references/releases.md#agent-release-preview-and-approval) | [Agent-assisted releases](../../../CONTRIBUTING.md#agent-assisted-releases) |
| Signed GitHub releases, Homebrew cask and packaged launcher | [Release distribution](references/releases.md) | [Installation](../../../docs/installation.md), [Release setup](../../../CONTRIBUTING.md#release-setup) |
| Explicit builds, publication and compiler cache | [Build workflow](references/build-cache.md) | [Contributing](../../../CONTRIBUTING.md#app-builds) |
| Optional external renderer for Pi web search/fetch/stored content/source check | [Pi Web Access cards](references/pi-web-access-plugin.md) | [Pi Web Access cards](../../../docs/pi-web-access-plugin.md) |
| Built-in Pi/Copilot card inventory, manual prompt recipes and automated coverage map | [Card inventory](references/card-plugins.md#built-in-inventory-and-manual-acceptance), [SQL](references/card-plugins.md#copilot-sql-cards) | [Built-in card cookbook](../../../docs/builtin-card-cookbook.md) |
| Mounted DOM renderers, cached personal TypeScript discovery/reload and legacy packages | [Card plugins](references/card-plugins.md) | [Card plugins](../../../docs/card-plugins.md), [Authoring](../../../docs/card-plugin-api.md) |

## Workflow and documentation

- Follow repository `AGENTS.md` for worktree, merge, cleanup and required validation policy. When broader validation is requested, use `mise run test`; include offline browser tests for scrolling changes. No automatic user-app launch/interruption; [build workflow](references/build-cache.md) owns requested publication.
- When feature work touches persistence, draft input, transcript/cards, session activation, sidebar projections or output-scroll/history layout, consult the relevant [performance optimization regression guardrails](../performance-optimizations/SKILL.md#maintaining-and-using-the-catalogue), not only when explicitly optimizing. They identify shared paths to reuse and fixture-extension triggers; this skill's feature references remain authoritative.
- Keep tests fixture-based. No paid requests, live compaction, user-session deletion or upstream extension changes without authorization.
- Every palette command must have a registered bindable action and shared dispatcher; empty defaults are allowed. Effective shortcut hints come from the registry. Native-only Open project remains an explicit exception. See [keybindings](references/keybindings.md#invariants).
- Follow [documentation ownership](references/architecture.md#documentation-ownership) for canonical contracts, user guides, evidence, history and discovery links. Update the owner rather than copying its schema, lifecycle or test results into related pages. The vocabulary skill owns names, not lifecycle specifications.
- Documentation links/anchors are checked offline by `npm run check:docs`, included in `mise run test`. The checker ignores fenced examples and never fetches external URLs.
