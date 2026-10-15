# Make transcript updates proportional to changed content

**Status: implemented; new fixtures authored, not run. Native responsiveness acceptance pending.**

## What changed and why

The prior streaming path projected every historical row on publication, then serialized every row on paint to rediscover the changed tool. `conversation-index.ts` now owns lazy, array-identity-scoped tool locations and content-change metadata. Reducer updates locate only matching invocations, copy only the affected message/block arrays and reuse locations when identities/positions are unchanged. Structural/history replacements rebuild the index lazily; adoption remains authoritative.

`transcript-updates.ts` publishes an optional revision/base plus exact dirty rows. Tool changes carry call IDs so presentation does not enumerate sibling invocation blocks. Unchanged message/block rows are weakly cached. Authoritative `state.messages` remains a full snapshot, lazily projected from the captured immutable canonical state only when requested. It does not retain a backward chain of prior states. Metadata refers to previous-array identity tokens, not strong previous-array links.

The mounted view accepts only continuous revisions, accumulates dirty rows across all events before a paint, and patches those rows without reading/projecting/serializing history or walking the tool registry. Local optimistic/receipt/queue operations, structural/progress changes, history replacement, missing metadata, revision gaps and recovery retain full reconciliation. Full fallback can still serialize rows; the normal tool-output path cannot. Ordered semantic observation remains synchronous; incremental content-only updates skip full optimistic-turn observation because they cannot introduce user/queue entries.

## Output, isolation and surrounding work

- Plain output appends to retained text nodes. Console control scanning/parsing consumes only the new suffix after append validation; ANSI appends retain existing style runs, while cursor overwrite/erase rebuilds affected lines.
- `output-source.ts` carries source-revision tokens through tool envelopes/cards without linking old snapshots. Prefix validation is deferred to rendered endpoints, cached once per source pair across presentation/raw recovery; skipped intermediate cumulative chunks do not cause prefix scans. Replacements/truncations fail that comparison and replace content. Unknown sources conservatively validate their own prefix. Tokens retain shared immutable source strings, not copies or backward state chains.
- Managed presentation sections report literal source coverage without reading accumulated DOM `textContent`. Custom mounted DOM retains the compatibility inspection fallback. Literal Raw output recovery appends independently and preserves its disclosure.
- Card data is still detached/deep-frozen. `immutable-snapshot.ts` copies JSON structure without cloning primitive strings, and shares only its own deeply frozen subtrees. Core snapshots tool arguments once when authoritative inputs arrive; output updates reuse them. Caller-frozen objects are not trusted merely because their root is frozen. Non-JSON compatibility values are detached rather than treated as shareable immutable trees.
- Unchanged inputs are not reserialized/replaced. Commands are processed only when their source list changes. Status/metrics/extensions/queue sections have dependency guards. Content-only session publications with unchanged shell dependencies skip sidebar/title/bookkeeping preparation; attention and lifecycle paths remain live.
- Scroll scope is described in [affected tool outputs](tool-output-scroll-work.md). [Cards](../../features/references/transcript-cards.md), [interaction](../../features/references/transcript-interaction.md) and [plugins](../../features/references/card-plugins.md) remain canonical behavior contracts.

## Remaining costs and tradeoffs

This is not a constant-time end-to-end protocol. Pi still supplies cumulative output; framing/JSON conversion depends on accumulated output size, and each painted source pair still requires one accumulated-prefix comparison. Immutable public message arrays still require an O(message count) shallow pointer copy, and an affected assistant's block array an O(block count) shallow copy. These copies do not inspect historical payloads. Ordinary assistant text changes still inspect the affected message's blocks and reparse changed Markdown, sanitize and highlight the full growing block. Tool completion/progress/placement changes may take full reconciliation. Console rewrites/conversion from literal text to terminal controls can replay/rebuild prior content; append-only ANSI runs do not.

Custom plugins still receive full immutable card snapshots via API v2; their work is unconstrained, and custom DOM raw verification can read their output. Large-history DOM/memory and platform layout/paint/GC costs remain separate, unmeasured concerns. No public plugin API change or framework was introduced.

Existing `timeline-projection`, `snapshot-delivery`, `transcript-render` and shell probes remain. Full lazy materialization happens at its requesting boundary (typically fallback delivery/render), not necessarily inside the publication's projection probe; inclusive timing attribution must account for that. No new native report or avoided-time measurement is claimed.

## Regression risks and maintenance guardrails

- Keep canonical arrays/blocks immutable. Only content updates with unchanged locations may inherit an index; tool identity removal/replacement/start/end and history replacement must invalidate or rebuild it. New event types must choose targeted metadata or full fallback explicitly.
- Revision metadata is optional and session-local. Accumulate IDs until paint, including hidden updates; gaps force authoritative reconciliation. Do not defer or discard queue/receipt/error/identity transitions.
- New shell/status fields need dependency guards. New presentation fields must participate in envelope/cache invalidation. Release mounted nodes on reset/removal/disposal; weak caches must not retain old output chains or leak across sessions.
- Append evidence must come from a verified rendered-source pair, never source length alone. Replacement/truncation and final output remain authoritative; control parsing, exact raw recovery and sanitization cannot be bypassed.
- Only internally branded deep-frozen JSON subtrees may be shared with plugins. Do not trust arbitrary `Object.freeze`, expose mutable core arguments, or memoize mutable custom values by identity.
- Preserve tool-ID shell identity, late authoritative inputs, manual disclosure/timers, raw/final output, optimistic aliases, focus and independent scroll intent. Full fallback remains required, not an error-only afterthought.

## Fixtures and evidence

Added/extended `test/transcript-updates.test.ts`, `test/native-view.test.ts`, `test/console-output.test.ts`, `test/shell.test.ts` and `test/browser/incremental-streaming.spec.ts`: increasing unchanged history with forbidden payload reads; exact tool IDs and retained row identity; coalesced parallel updates; revision gaps; restoration/adoption/stale lifecycle; retained plugin input/focus; zero unrelated output geometry reads; append text/run identity; managed raw verification without DOM text reads; immutable arguments; hidden catch-up/completion; unchanged shell/status/IPC; real-layout following versus independent inspection.

These fixtures, checks and builds have not been run for this change. When validation is requested, run `mise run check` and `npm run test:browser`. Native macOS responsiveness/reveal/trackpad acceptance and Linux/possible Windows behavior remain unverified. Compare avoided-work counters and behavior, not timing-only thresholds or claims of compositor/GC improvements.
