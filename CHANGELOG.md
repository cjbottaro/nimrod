# Changelog

Notable user-visible changes to Nimrod. **Unreleased** describes development changes, not an available public release. See [Contributing](CONTRIBUTING.md#changelog-and-local-development) for the maintenance policy.

## Unreleased

### Added

- Copilot web-search cards with formatted answers, numbered citations and source lists; fetch cards with compact URLs, readable page/raw-source content, visible redirects/truncation/errors, and literal SDK permission requests. Web links open through Nimrod’s existing handler; original output remains available in Raw output.
- Compact Copilot cards for file reads, text searches and filename-pattern searches, with project-relative paths inside the project (absolute paths outside), path-then-line-range read summaries, query-first search summaries and cleaner plain-content results backed by exact raw-output recovery. Shared read/search presentation helpers are also available to external card plugins.
- Opt-in tool activity capture in global Diagnostics: automatic native Pi/extension, Copilot SDK and custom ACP tool payload logs, separated by harness/agent and UTC day under Nimrod’s XDG state directory, with timestamped append-only JSONL records for bespoke card development. Logs stay local and are retained until explicitly removed.
- Built-in **New Copilot session** uses the bundled official SDK 1.0.22 with your installed/authenticated CLI (declared compatibility: 1.0.98) and supported Node. SDK sessions reuse the shared transcript, drafts, permissions/questions, tools, notifications and model/thinking controls, with exact-ID Resume and confirmed-only permanent SDK deletion. Close preserves history/drafts; failed or uncertain sends/deletes never replay. The previous Copilot integration is removed; its old stored drafts/history are not deleted or migrated. Harness labels are simply **Copilot**, and the new-session hint is concise. Pi stays the default for New; experimental custom ACP remains separate and capability-driven. SDK fixtures, packaging and native macOS/Linux acceptance are pending; Windows SDK launch, SDK/ACP Restart and images remain unavailable. Copilot slash commands are discovered/invoked through the SDK, with aliases, advertised argument hints/choices, harness-requested modal selections and labelled transcript output; new commands using supported result types need no command-specific handler. Unknown/unsupported operations never fall back to chat. Model/scoped-setting invocation effects and richer dialog kinds remain unsupported; command fixtures/native acceptance are pending.
- Public card-plugin presentation/shell-output helpers, explicit harness/agent targeting and mount-time applicability, preserving legacy plugins as Pi-only by default.

### Changed

- ACP command permissions use a compact **Run command · description** summary, exact command previews without duplicate metadata, and collapsed raw details below the existing permission buttons. Long descriptions wrap without truncation; unsupported operations retain the literal fallback.
- Experimental ACP plugins distinguish tool names (`tools`) from protocol categories (`kinds`); early POC category-based plugins must move their matching to `kinds`. Agent-specific matches take precedence over generic ACP matches.

- macOS release downloads and Homebrew installation target Apple Silicon only; Intel downloads are not provided.
- GitHub release notes use reviewed changelog entries, with Unreleased snapshots for prereleases.

### Fixed

- Copilot SDK tool capture includes streamed tool inputs and native permission request/completion events, correlates nested permission tool IDs, retains the reported runtime version, and safely records callbacks received before session identity is known. SDK logs remain separate from Pi and custom ACP captures.
- Copilot SDK session snapshots, web citation offsets and the shell's self-referential command-choice initializer retain explicit types, fixing TypeScript compilation after the SDK migration and slash-command integration.
- Bundled Copilot card adapters recognize the CLI’s reported `Copilot` agent identity, including the existing command-output adapter.
- Resume session sorts Pi and Copilot history together by displayed recency rather than grouping by source/catalog order. Shared session rows show the harness immediately after the date, below the title.
- ACP retains nullable tool patches and consecutive rich-content blocks, applies permission patches in wire order without overwriting newer tool updates, restores configuration controls after working turns, and drains agent output while writing large requests or stopping.
- Disabled or revoked card plugins cannot run applicability callbacks through old catalog entries while a reload is pending.
