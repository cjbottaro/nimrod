# Card plugins

**Status: bundled renderers implemented; external plugins planned.** Tool cards, reasoning cards and the parallel-tools overview now use bundled presentation plugins. There is no external installation or renderer-selection UI yet.

Customizable cards are a central direction for Nimrod: tools and workflows should have purpose-built presentations in the transcript, rather than only text output. Pi extensions define agent capabilities; Nimrod card plugins define how those capabilities are presented.

## Built-in and custom cards

Default tool, reasoning and parallel-tools renderers ship as bundled Nimrod plugins through a shared presentation-only instance contract. Core creates and updates the mounted UI; plugins supply validated content rather than accessing the transcript DOM or agent transport. The migration preserves current card behavior and appearance. The contract remains internal until external loading is implemented.

The intended customization includes alternative presentations for existing tools and, later, structured content produced by companion Pi extensions. Diff, subagent, test-result and research cards are examples of possible presentations, not committed individual features.

## Consistent behavior

Nimrod will continue to own card placement, lifecycle, disclosure, focus and scrolling. Plugins will provide the summary content and expanded-body presentation. A minimal raw-data renderer will remain available if a plugin is missing, cannot handle the content or fails; saved results must remain readable without their plugin.

This is a card-rendering extension point, not initially an unrestricted extension API for the entire app. Any interactive card actions will use explicit host-supported operations; rendering alone will not authorize agent execution.

## What remains undecided

Plugin packaging, installation, isolation, renderer selection and overrides, supported actions, and the transport for custom Pi content are not yet specified. Pi's existing text widgets and dialogs do not provide a rich-card transport, and TUI-only extensions will not automatically become GUI plugins.

There is no delivery schedule. Bundled renderers may ship before external plugin loading becomes available.
