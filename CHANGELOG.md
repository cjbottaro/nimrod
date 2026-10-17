# Changelog

Notable user-visible changes to Nimrod. **Unreleased** describes development changes, not an available public release. See [Contributing](CONTRIBUTING.md#changelog-and-local-development) for the maintenance policy.

## Unreleased

### Added

- Compact Copilot cards for file reads, text searches and filename-pattern searches, with project-relative paths inside the project (absolute paths outside), path-then-line-range read summaries, query-first search summaries and cleaner plain-content results backed by exact raw-output recovery. Shared read/search presentation helpers are also available to external card plugins.
- Opt-in tool activity capture in global Diagnostics: automatic native Pi/extension and ACP tool payload logs, separated by harness/agent and UTC day under Nimrod’s XDG state directory, with timestamped append-only JSONL records for bespoke card development. Logs stay local and are retained until explicitly removed.
- Experimental ACP session POC alongside Pi: Copilot/custom-agent launch, shared transcript cards, session-local permissions with retained operation details, cancellation and advertised model/thinking/mode configuration and commands. Copilot sidebar entries and drafts survive reopening a project; selecting a restored entry loads its exact saved conversation without sending a prompt. Resume combines Pi with capability-gated Copilot history in associated projects, retaining usable results when another source is slow or unavailable and restoring closed conversations by exact ID. Advertised Copilot single-session deletion uses the shared trash controls and cleanup picker, stops only its owned agent and removes drafts/references only after confirmation; Pi retains its tree transaction. Restart remains Pi-only; custom ACP sessions remain runtime-only. Real-agent/native acceptance remains pending.
- Public card-plugin presentation/shell-output helpers, explicit harness/agent targeting and mount-time applicability, preserving legacy plugins as Pi-only by default.

### Changed

- ACP command permissions use a compact **Run command · description** summary, exact command previews without duplicate metadata, and collapsed raw details below the existing permission buttons. Long descriptions wrap without truncation; unsupported operations retain the literal fallback.
- Experimental ACP plugins distinguish tool names (`tools`) from protocol categories (`kinds`); early POC category-based plugins must move their matching to `kinds`. Agent-specific matches take precedence over generic ACP matches.

- macOS release downloads and Homebrew installation target Apple Silicon only; Intel downloads are not provided.
- GitHub release notes use reviewed changelog entries, with Unreleased snapshots for prereleases.

### Fixed

- Bundled Copilot card adapters recognize the CLI’s reported `Copilot` agent identity, including the existing command-output adapter.
- Resume session sorts Pi and Copilot history together by displayed recency rather than grouping by source/catalog order. Shared session rows show the harness immediately after the date, below the title.
- ACP retains nullable tool patches and consecutive rich-content blocks, applies permission patches in wire order without overwriting newer tool updates, restores configuration controls after working turns, and drains agent output while writing large requests or stopping.
- Disabled or revoked card plugins cannot run applicability callbacks through old catalog entries while a reload is pending.
