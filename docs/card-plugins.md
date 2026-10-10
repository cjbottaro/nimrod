# Card plugins

**Status: planned feature.** Card plugins are not implemented yet; there is no plugin installation or renderer-selection UI today.

Customizable cards are a central direction for Nimrod: tools and workflows should have purpose-built presentations in the transcript, rather than only text output. Pi extensions define agent capabilities; Nimrod card plugins define how those capabilities are presented.

## Built-in and custom cards

Default card renderers will ship as bundled Nimrod plugins, using the same supported rendering API as third-party plugins. The initial migration will preserve current card behavior and appearance. Bundled plugins can ship before external plugin loading is available.

The intended customization includes alternative presentations for existing tools and, later, structured content produced by companion Pi extensions. Diff, subagent, test-result and research cards are examples of possible presentations, not committed individual features.

## Consistent behavior

Nimrod will continue to own card placement, lifecycle, disclosure, focus and scrolling. Plugins will provide the summary content and expanded-body presentation. A minimal raw-data renderer will remain available if a plugin is missing, cannot handle the content or fails; saved results must remain readable without their plugin.

This is a card-rendering extension point, not initially an unrestricted extension API for the entire app. Any interactive card actions will use explicit host-supported operations; rendering alone will not authorize agent execution.

## What remains undecided

Plugin packaging, installation, isolation, renderer selection and overrides, supported actions, and the transport for custom Pi content are not yet specified. Pi's existing text widgets and dialogs do not provide a rich-card transport, and TUI-only extensions will not automatically become GUI plugins.

Implementation will proceed incrementally: establish the rendering boundary, migrate bundled renderers, prove the API with a richer card, then add external plugin support. No delivery schedule or cross-platform acceptance is implied.
