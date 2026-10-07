# Transcript cards

## Code map and invariants

- `src/pi/tool-card.ts`: incremental tool-card summary, indicator, input preview, raw inputs and output rendering.
- `src/pi/reasoning-card.ts`: Pi-provided reasoning disclosure and first-line preview.
- Card summaries, indicators and previews have no `title` attributes: hovering does not show native tooltips, including after streaming/lifecycle updates.
- Preserve summary `aria-label` status descriptions, visible previews, raw inputs and expanded reasoning. Full content remains available by expanding the disclosure rather than hovering.
- Code Copy/Pop out button tooltips and status/composer controls are unaffected.
- Preserve connected spinner/disclosure nodes, manual toggle precedence, automatic disclosure timing and output scrolling; see [architecture](../../../../docs/architecture.md#rendering-contract-retained-from-pi-gui).

## Verification

`test/tool-card.test.ts` and `test/reasoning-card.test.ts` assert absence of tooltip attributes on initial rendering and updates while retaining accessible status labels. These DOM tests do not establish native hover acceptance; validate the packaged app visually without launching or interrupting the user's window automatically.
