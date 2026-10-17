# Changelog

Notable user-visible changes to Nimrod. **Unreleased** describes development changes, not an available public release. See [Contributing](CONTRIBUTING.md#changelog-and-local-development) for the maintenance policy.

## Unreleased

### Added

- Experimental ACP session POC alongside Pi: Copilot/custom-agent launch, shared transcript cards, session-local permissions with retained operation details, cancellation and advertised model/thinking/mode configuration and commands. Pi's saved-history commands remain distinct. Saved ACP history and real-agent/native acceptance remain pending.
- Public card-plugin presentation/shell-output helpers, explicit harness/agent targeting and mount-time applicability, preserving legacy plugins as Pi-only by default.

### Changed

- Experimental ACP plugins distinguish tool names (`tools`) from protocol categories (`kinds`); early POC category-based plugins must move their matching to `kinds`. Agent-specific matches take precedence over generic ACP matches.

- macOS release downloads and Homebrew installation target Apple Silicon only; Intel downloads are not provided.
- GitHub release notes use reviewed changelog entries, with Unreleased snapshots for prereleases.

### Fixed

- ACP retains nullable tool patches and consecutive rich-content blocks, restores configuration controls after working turns, and drains agent output while writing large requests or stopping.
