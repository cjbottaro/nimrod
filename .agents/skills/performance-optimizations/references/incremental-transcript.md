# Make transcript updates proportional to changed content

**Status: deferred candidate. Suggested priority: second remaining; medium-to-high reconciliation risk.**

## Why

On each transcript paint, `renderState` projects all display messages and computes `JSON.stringify(message)` for every row to detect changes. Upstream `PiSession.publish` also projects the full tool timeline on every publication. Changed Markdown blocks are synchronously parsed, sanitized and syntax-highlighted.

Even when only the final text block grows, immutable history is repeatedly traversed/serialized. Large histories and outputs can make this work scale with transcript size rather than the changed content. Frame-coalesced painting already exists; adding another delay alone does not address this scaling.

## Potential benefits

- Reduce repeated history traversal, serialization and allocation.
- Keep live-token update cost relatively stable as conversations grow.
- Avoid regenerating unchanged Markdown/code and card content.
- Reduce GC pressure and leave more UI-thread headroom.

Actual Markdown rendering of changed content remains necessary; do not promise constant-time updates for arbitrarily large growing blocks.

## Experiment outline

Start with avoiding work for known-stable rows/blocks, using narrowly owned revisions, dirty keys or safe immutable identity caches. Trace reducer identity guarantees before relying on reference equality: timeline projection and authoritative history snapshots can create fresh objects for unchanged semantic content.

Retain a full reconciliation fallback for history replacement/reset or snapshots without reliable dirty metadata. Account for tool placement/phase changes, parallel overview insertion/removal, pending-user aliases, sticky queues and error/status-only changes. Consider upstream projection caching separately only after locating its measured cost.

Do not unsafely append HTML fragments or bypass Markdown sanitization/highlighting rules. Partial Markdown parsing would be a separate correctness-sensitive experiment.

## Constraints and current contracts

Read [cards](../../features/references/transcript-cards.md), [composer](../../features/references/composer.md), [Pi transport](../../features/references/pi-transport.md), [syntax highlighting](../../features/references/syntax-highlighting.md) and [transcript interaction](../../features/references/transcript-interaction.md).

Keep every ordered state transition observable even when paints are coalesced. Preserve tool-call-keyed shell identity, late authoritative inputs, final/raw outputs, manual disclosures, optimistic-turn adoption and focus/scroll intent. A content cache must invalidate on relevant rendering configuration and release entries on reset/removal/disposal; never leak caches between sessions.

Primary code anchors: `src/pi/webview-client.ts` (`renderState`, `patchMessage`), `src/pi/session.ts` (`publish`), `src/pi/tool-progress.ts`, `src/pi/reducer.ts`, `src/pi/steering-transcript.ts` and `src/pi/safe-markdown.ts`.

## Validation target

With fixed-size incoming deltas and progressively larger immutable histories, count rows serialized, blocks parsed and nodes mutated. Unchanged history should not be reserialized/reparsed on every token; explicit full reconciliation should still produce correct output.

Retain reducer, tool lifecycle, native-view, Markdown/highlighting, steering and queued-turn tests. Add authoritative snapshot replacement, status-only transitions, tools moving between envelopes, removed rows and reset/cache-release cases. Run offline WebKit reader/follow/focus regressions and measure memory as well as time. This candidate is distinct from [large-history DOM reduction](large-history-dom.md): cheaper diffing does not reduce already-mounted DOM.
