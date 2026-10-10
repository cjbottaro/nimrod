# Card plugins

**Status: planned; no plugin API or loading implementation exists yet.**

User-facing feature description: [Card plugins](../../../../docs/card-plugins.md).
This reference records accepted architectural decisions and the living implementation plan. Keep API details provisional until renderer extraction provides evidence.

## Accepted decisions

- Customizable cards are a central Nimrod product direction, not merely theme customization.
- Default card renderers ship as bundled Nimrod plugins and exercise the same supported API as third-party renderers. Do not create undocumented built-in-only capabilities.
- Core owns card identity, transcript placement, authoritative lifecycle, disclosure, focus, scrolling, renderer selection and failure containment. Plugins own summary content, input-preview content, expanded-body presentation and interpretation of supplied results.
- Core retains a minimal raw-data fallback for missing, incompatible or failed renderers. This is recovery infrastructure, not a parallel privileged presentation system. Saved results remain readable without a plugin.
- Initial extraction preserves existing visible behavior. The eventual renderer contract should be derived from actual bundled implementations, not a hypothetical marketplace specification.
- The same rendering API does not require identical packaging or execution environments on day one. Bundled renderers may precede external loading and isolation.
- Interactive controls must use explicit host-supported actions. Rendering is not permission to execute arbitrary commands, submit prompts or change harness-owned state. Historical content and live action availability must remain distinguishable.
- Keep the initial scope to card rendering, not arbitrary app-wide GUI extensions. Pi remains authoritative for conversations, tools, models and configuration; do not invent a universal harness protocol.

### Why

Using the plugin contract for normal sessions continuously exercises it, makes bundled renderers useful examples, and prevents a second-class extension API alongside a privileged built-in renderer. Keeping behavioral infrastructure in core avoids duplicating disclosure, lifecycle and scroll logic in every plugin.

## Open questions (not accepted API decisions)

- Plugin manifest, packaging, discovery, installation, API versioning and compatibility policy.
- Execution environment, isolation, allowed styling, resource access and failure boundaries. API parity alone does not establish safe external-code loading.
- Renderer matching, precedence, user overrides and when a renderer may change for an existing card.
- Exact incremental update/disposal contract, summary/body slots and state ownership at the API boundary.
- Host action capabilities, explicit execution semantics and historical/closed-session behavior.
- Structured custom-content transport and persistence through the concrete Pi integration. Current RPC text widgets/dialogs are not a rich-card channel; TUI component factories cannot simply be reused.
- Scope and order of reasoning-card extraction after the initial tool-card work.
- Which richer card proves the API. Diffs and subagents are candidates, not approved implementation tasks. Subagent detail must come from actual data, not inferred status counts.

## Current code map

These are existing anchors, not a completed boundary audit. Start with the [transcript-card reference](transcript-cards.md) and [rendering contract](../../../../docs/architecture.md#rendering-contract-retained-from-pi-gui).

| Anchor | Current responsibility |
| --- | --- |
| `src/pi/tool-call.ts` | Partial tool-call merges and lifecycle precedence |
| `src/pi/reducer.ts` | Call-ID reconciliation of execution, results and assistant content |
| `src/pi/webview-client.ts` | Per-session node registry, placement, disclosure and scroll coordination |
| `src/pi/tool-card.ts` | Incremental tool-card summary, input preview, raw inputs and output |
| `src/pi/reasoning-card.ts` | Harness-provided reasoning disclosure and preview |
| `src/pi/transcript-presentation.ts` | Transcript presentation including standalone tool envelopes |

## Invariants to preserve

- One tool card per invocation ID; placement changes reuse its mounted shell. Preserve connected disclosure/indicator nodes and independently inspected output positions.
- Generation, execution output, completion and result processing remain distinct. Late earlier-phase events must not rewind final state.
- Core retains closed-by-default behavior, sustained-update auto-open timing, manual-choice precedence and existing output caps. Plugins do not duplicate those policies.
- Streaming, renderer errors and content resizing must preserve transcript/output auto-follow intent, older-history reading position, modal focus and hidden-session state.
- Preserve raw inputs/results, accessible status labels, safe content rendering and existing tooltip-free summaries. Rendering never acknowledges or replays a prompt.
- Keep lifecycle/data interpretation Pi-specific where required. Do not modify upstream Pi or the sibling pi-gui extension as part of extraction.
- Shared card behavior must remain portable: macOS first, Linux next, Windows possible later. A passing DOM test is not native/platform acceptance.

## Incremental implementation plan

All milestones are pending. Treat each as independently mergeable work in a dedicated task worktree. Dependencies are sequential unless noted; external loading must not gate bundled extraction.

| Milestone | Dependency | Acceptance criteria |
| --- | --- | --- |
| 1. Audit current rendering boundaries | None | Read the relevant source/tests; map core behavior versus presentation and identify extraction seams. Record baseline coverage and gaps here. |
| 2. Introduce the internal renderer contract | 1 | Existing tool cards render through the boundary without visible behavior changes. Core still owns the shell and policies; unsupported content and renderer failure have tested raw fallback behavior. |
| 3. Extract bundled renderers | 2 | Default tool-card presentations use the supported contract without privileged access. Record the concrete built-in inventory and reasoning-card scope; remaining default card renderers must be tracked explicitly, not silently exempted. |
| 4. Prove extensibility with a richer renderer | 3 | Choose a concrete card with available structured fixture data. Implement it using only the contract and host-supported capabilities, without tool-specific presentation branches in core. Refine the API from evidence. |
| 5. Support external plugins | 4 | Resolve packaging, compatibility, isolation, matching/overrides and action permissions before loading external code. Test missing/incompatible/failing plugins and historical fallback; document actual installation and selection behavior. |

Custom Pi-produced content is a separate follow-on track: resolve transport and history semantics before committing implementation milestones. It is not a prerequisite for alternative renderers of existing tool calls.

For each milestone, update this reference with changes, remaining questions and actual verification, and update the public guide with what has shipped. Retain the planned label while the feature remains unavailable; distinguish shipped subsets from remaining work afterward.

## Verification

No implementation or plugin acceptance has been established by this planning document.

Relevant existing regression suites include `test/tool-call.test.ts`, `test/tool-input-lifecycle.test.ts`, `test/native-view.test.ts`, `test/transcript-presentation.test.ts`, `test/tool-card.test.ts` and `test/reasoning-card.test.ts`. Add contract and fallback tests as the boundary is implemented.

Implementation requires `mise run check` and `mise run build`; scrolling changes also require the offline `npm run test:browser` suite. Keep tests fixture-based, with no paid requests or live session mutation. Request user validation for packaged-app visual behavior; record per-platform verification separately.
