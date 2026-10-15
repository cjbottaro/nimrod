# Limit tool-output scroll work to affected viewports

**Status: implemented alongside [incremental transcript updates](incremental-transcript.md); fixtures authored, not run. Native acceptance pending.**

## What changed and why

Previously every transcript paint captured positions across the mounted tool registry and scheduled one restoration callback per connected card, including completed/unrelated cards. The renderer now determines changed rows before mutation, captures only their tool output viewports and schedules one guarded batch for affected live outputs. Ordinary incremental paints do not traverse/prune the registry; structural full reconciliation owns removal/disposal. Unchanged cards do not receive renderer updates, geometry reads or output-restoration callbacks.

Full hide captures all inspection positions while geometry is visible. Reveal restores the suspended positions, including untouched viewports, while catching up the latest snapshot. Reset/disposal still cancel frames and retire epochs. These deliberate lifecycle boundaries retain broad bookkeeping; they are not the streaming hot path.

`DomCardController` remains the synchronous owner for all registered output viewports within an affected card, including multi-output custom plugins and completion caps. The outer renderer retains a deferred settled-layout pass for affected live cards and hide/reveal. Their scopes now agree on affected cards; synchronous registered-output restoration was not removed as supposedly redundant. Capture work precedes card mutations; deferred core restoration is batched rather than scheduled per registry entry.

## Benefits and remaining costs

Eliminates unrelated card/viewport work and callbacks, including completed-card no-op frames. This is confirmed avoided work, not a measured native layout/latency speedup. Affected cards can still perform both synchronous plugin-output and deferred core-output restoration. Browser geometry/layout reads and writes remain necessary; plugin-owned async mutations must use managed ownership. Layout changes from width/zoom/disclosure continue through existing owners.

Canonical contracts: [interaction](../../features/references/transcript-interaction.md), [cards](../../features/references/transcript-cards.md), [plugins](../../features/references/card-plugins.md). Code: `webview-client.ts`, `card-shell.ts`, `dom-card-renderer.ts`, `transcript-scroll.ts`.

## Regression risks and maintenance guardrails

- Add new tool/output types to affected-row discovery and registered keyed output ownership, not ad hoc registry-wide scans. Full structural reconciliation must still prune removed plugin instances/cards.
- Preserve each output's reading/follow intent independently from siblings and transcript follow. Keep lifecycle caps, manual disclosure, control/truncation/replacement behavior and supported custom outputs.
- Capture intent before DOM mutation; guard deferred work across hide/reveal/reset/disposal. Never infer intent from zero hidden dimensions. Hidden reveal must restore suspended untouched positions as well as changed cards.
- Do not remove the synchronous plugin owner without proving final caps and multi-output custom behavior. New async mutation/layout features must preserve managed ownership and include width/zoom/disclosure/reveal cases.

## Fixtures and evidence

`test/native-view.test.ts` adds simultaneous/coalesced updates with zero unrelated geometry reads, retained plugins/focus and hidden catch-up/completion. `test/browser/incremental-streaming.spec.ts` checks plain text-node identity, independent inspected/following/untouched outputs, zero unrelated-card mutations and final terminal-style replacement. Existing console, hidden-session, tool-card/DOM-renderer and native-view scroll fixtures remain required.

No tests/checks/builds or new native report were run for this implementation. Requested validation uses `mise run check` plus `npm run test:browser`; fixtures do not establish native trackpad, zoom, macOS/Linux/possible Windows acceptance.
