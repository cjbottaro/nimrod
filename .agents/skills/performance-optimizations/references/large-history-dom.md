# Reduce large-history rendering and DOM cost

**Status: deferred candidate. Suggested priority: last/measurement-gated; high interaction and platform risk.**

## Why

Session transcripts keep historical articles, Markdown/code and tool-card DOM mounted. Large histories can grow node count, memory, style/layout and paint cost even after per-update diffing is optimized. Keeping many session views mounted can multiply retained memory.

The observed persistence-related improvement does not prove that large DOM is currently a bottleneck. Revisit this only with a representative large-history fixture or native evidence of engine/layout/memory pressure.

## Potential benefits

- Lower offscreen layout/paint work with supported rendering containment.
- Lower mounted-node and memory cost if selective materialization is justified.
- Faster opening and navigation through very large histories.
- Less accumulated rendering pressure in long-lived windows.

CSS containment/content visibility can retain all DOM and may not reduce memory. Virtualization can reduce mounted nodes but has substantially more behavioral cost; these are different experiments, not interchangeable fixes.

## Experiment outline

First profile node count, memory, engine layout/paint and scrolling across history sizes after simpler optimizations. Try narrowly scoped CSS containment/content visibility with capability fallback before introducing a virtualized transcript.

If virtualization is necessary, design stable message keys, measured placeholder heights, anchor restoration, materialization rules and retained card/disclosure/inspection state. Treat offscreen DOM lifecycle and plugin lifecycle explicitly; repeated unmount/remount is not automatically compatible with the mounted-card API. Do not reuse one renderer across sessions or discard authoritative history.

## Constraints and current contracts

Read [transcript interaction](../../features/references/transcript-interaction.md), [cards](../../features/references/transcript-cards.md), [card plugins](../../features/references/card-plugins.md), [pop-outs](../../features/references/pop-outs.md) and [syntax highlighting](../../features/references/syntax-highlighting.md).

Preserve selection/copy across turns, accessible reading order, keyboard focus/navigation, disclosure state, code actions, independent tool inspection and sticky queued turns. Determine current find behavior before choosing a strategy; if content becomes absent from DOM, do not silently break text search or invent a new find feature as an incidental optimization.

Estimated heights can cause jumps with variable Markdown, images, code, disclosures and native zoom. Existing follow/reader anchoring remains authoritative. CSS/engine support and behavior must be assessed per platform: macOS is first, Linux next, Windows only a possible future target.

Primary code anchors: `src/pi/webview-client.ts` (message registry and reconciliation), `src/pi/transcript.css`, `src/pi/transcript-scroll.ts`, `src/pi/dom-card-renderer.ts` and session-view lifetime in `src/main.ts`.

## Regression risks and maintenance guardrails

This candidate is not implemented; containment and virtualization require distinct designs and acceptance evidence.

- **Likely erosion:** new images, variable-height blocks, disclosures or sticky elements invalidate height/anchor assumptions. Repeated materialization can recreate cards, lose selection/focus and leak plugin resources; CSS containment can introduce platform-specific clipping or geometry behavior.
- **Reuse the boundary if implemented:** keep authoritative history separate from materialized DOM and use stable session/message/card identity plus the existing scroll owner. Define offscreen plugin/disclosure/inspection retention explicitly; do not equate DOM absence with semantic deletion.
- **Correctness traps:** preserve multi-turn selection/copy, accessible reading order, supported find behavior, code actions and keyboard focus. Invalidate height estimates on content/layout/zoom changes; keep capability fallbacks and verify actual webview behavior rather than assuming browser-engine parity.
- **Extend fixtures when changing:** block types, image loading, card lifecycle or transcript layout. Extend the long-history interactions below with representative content and repeated materialization/reset/disposal. Track mounted nodes, retained resources/memory and actual layout/paint savings; containment alone does not establish lower memory use. Native/platform acceptance remains separate.

## Validation target

Demonstrate a substantial layout/paint or memory reduction on a representative large-history fixture before accepting the added complexity. Compare equivalent visible content and interactions, not an empty transcript against a complete one.

Require long-distance scrolling, resize/zoom, images, multi-turn selection/copy, keyboard/accessibility, relevant find behavior, tool/plugin lifecycle, sticky queues, reset/removal and hidden-session reveal regressions. Run required offline WebKit tests, then obtain packaged native scrolling/memory evidence. Do not claim Linux or Windows parity from macOS/browser fixtures.
