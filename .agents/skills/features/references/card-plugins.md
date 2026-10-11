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

Milestone 1 audited these anchors and their regression suites at baseline `9607a5e`. The [transcript-card reference](transcript-cards.md) and [rendering contract](transcript-interaction.md) remain canonical owners of current behavior.

| Anchor | Current responsibility |
| --- | --- |
| `src/pi/tool-call.ts` | Partial tool-call merges and lifecycle precedence |
| `src/pi/reducer.ts` | Call-ID reconciliation of execution, results and assistant content |
| `src/pi/webview-client.ts` | Per-session node registry, placement, disclosure and scroll coordination |
| `src/pi/tool-card.ts` | Incremental tool-card summary, input preview, raw inputs and output |
| `src/pi/reasoning-card.ts` | Harness-provided reasoning disclosure and preview |
| `src/pi/transcript-presentation.ts` | Transcript presentation including standalone tool envelopes |

## Rendering-boundary audit (milestone 1)

### Data and placement path — retain in core

1. `reducer.ts` / `tool-call.ts` reconcile Pi generation, execution and result events by invocation ID, with terminal lifecycle precedence and authoritative complete arguments. Neither renderer matching nor plugin state belongs here.
2. `tool-progress.ts` projects transcript rows, result-processing/interruption phases and the temporary parallel-tools overview. `session.ts:publish` sends that projection to the view without changing authoritative history. Renderers consume the projected lifecycle; they must not infer or rewrite it.
3. `webview-client.ts` owns per-view article reconciliation, tool registry, disclosure map and controller. Tool keys are `tool:<id>`; missing IDs use placement-scoped keys. Reasoning currently uses message/block keys, not the tool registry.
4. `renderToolCard` creates or updates registry entries, but `patchMessage` also calls `updateToolCard` directly for standalone and assistant-embedded cards. A boundary must route **all three paths**, not merely replace the creation call. Keep `reconcileContentBlock` and article placement outside renderer implementations.

### Responsibility split and extraction seams

| Existing code | Keep in core | Renderer-owned presentation / extraction seam |
| --- | --- | --- |
| `tool-card.ts:renderToolCard/updateToolCard` | Mounted details/summary shell, authoritative status indicator and accessible status label, stopped-phase notice | Tool name presentation, preview content, input/result presentation. Today one function mixes both sides; give renderers explicit content slots rather than the whole details element. |
| `tool-card.ts:inputPresentation` and parsing helpers | No tool-name branches in the future shell | Existing name normalization, partial top-level JSON strings and tool-specific preview choices belong with bundled presentation. Extract once; the parallel-tools overview also consumes `toolInputPreview`. |
| `tool-card.ts:updateInputs/updateOutputs` | Raw recovery availability and output-viewport policy | Current body is literal raw inputs and text outputs. Keep the nested Raw inputs disclosure and keyed output sections mounted during updates. The default renderer and minimal fallback may share raw rendering primitives, not a privileged second tool-specific renderer. |
| `tool-card.ts:createToolDetails/setToolDetailsAutoOpen` plus `tool-disclosure.ts` | Manual-choice tracking, 500ms qualification/dwell scheduler and lifecycle eligibility | Move shell helpers/constants out of the presentation module before making it a plugin; the controller currently imports them from `tool-card.ts`. Plugins must not set `open` or restart timers. |
| `tool-card.ts:captureStreamingOutput/restoreStreamingOutput` and `webview-client.ts:render` | Independent output inspection and transcript-follow ordering | Today capture/restore uses the first `.tool-output-streaming` descendant per card. Replace implicit CSS discovery with an explicit host-owned viewport association before supporting richer/multiple output viewports. Preserve existing behavior during initial extraction. |
| `reasoning-card.ts` | Disclosure state, status/indicator identity and omission of empty/opaque reasoning | First-nonempty-line preview and Markdown body are renderer presentation. Body is currently replaced on every update; do not claim inner Markdown-node/focus preservation. Reasoning has no tool auto-open scheduler. |
| `tool-progress.ts:renderParallelToolCard` | Live-only cluster membership/placement and authoritative member states | List/title/member previews form another built-in card presentation, currently in the same file as progress projection. Track extraction separately; it starts open and must not inherit tool-card auto-open rules. |
| `safe-markdown.ts` / delegated clicks in `webview-client.ts` | Sanitization, source capture and validated Copy/Pop out/link host operations | A renderer may request supported presentation helpers/actions later, not receive arbitrary `postMessage`, composer, session or transport access. |
| `transcript.css` | Disclosure arrow/guide, status indicator, fluid layout and eight/sixteen-line output caps | Current selectors depend on direct children (`.tool-section`, `.tool-raw-inputs`, `.reasoning-body`). Adding slot wrappers requires CSS/geometry regressions; a wrapper is not automatically behavior-neutral. |

### Concrete bundled inventory

There is currently **one generic tool-card body**, not separate read/write/bash plugins. Its preview branches are:

- File operations: `read`, `write`, `edit` and supported path-field aliases.
- Shell: `bash`, `shell`, `terminal` and command-field aliases.
- Agent aliases and `steer_subagent`: description/message, including completion-only missing-field placeholders.
- Web search/fetch: singular plus plural queries/URLs; search/find/grep/glob: pattern and optional path.
- Unknown tools: completion-only field count, with raw inputs/output still readable.

The body preserves distinct execution and final result text when they differ, deduplicates identical output, and retains output-section identity by kind. While busy (including result processing), output uses the live cap; otherwise the final cap. Raw inputs are a separate closed-by-default nested disclosure. Preserve this inventory without prematurely requiring one plugin per preview branch.

Other card-shaped presentations are reasoning and the parallel-tools overview. Skill disclosures (`skill-invocation.ts`) belong to user-turn presentation and are outside this initial tool/reasoning extraction, not an undocumented exemption for a default tool renderer.

### Material constraints and remaining gaps

- **Structured result data is not available at the renderer boundary today.** `reducer.ts:toolOutput/contentText` concatenates text blocks and drops non-text blocks/result metadata; `ContentBlock` and `ToolCardBlock` expose only execution/result strings. Raw fallback currently means retained inputs/text, not the full original Pi result envelope. A richer result renderer needs an explicit, fixture-tested Pi data-preservation change before selection; do not reconstruct metadata from formatted text or status counts.
- **Current recovery is message-wide, not plugin containment.** `queueRender` catches a render failure, clears/rebuilds the transcript and falls back to `message.content`. This is not adequate card-local fallback (standalone output may live outside `content`). A renderer throw must not take this path as normal recovery or replace healthy sibling shells.
- **No instance lifecycle exists yet.** Define internal mount/update/dispose and card-local error cleanup from the default renderer, then test removal, reset and view disposal. Today detached tool registry entries are pruned, while disclosure controller states are cleared at reset/dispose or same-key replacement, not individually released on prune. A plugin instance must not leak handlers/timers on removal.
- **Async content resize is not a generic renderer capability yet.** The view observes the transcript viewport, handles window resize, and explicitly calls resize on image load/error. Richer asynchronous body growth needs a host-mediated resize path that retains follow/reader intent, hidden-view behavior and modality.
- **Output scroll coverage is limited.** Helpers track live viewports only; terminal transition, two distinct busy output sections and richer renderer replacement need explicit acceptance/tests rather than claiming all final-output offsets are restored.
- Matching, overrides, external code loading, packaging and action permissions remain open. None is required to introduce the internal default-renderer boundary.

### Baseline coverage and additions

| Contract | Evidence / gap |
| --- | --- |
| Partial arguments, authoritative inputs, both source orders, history/result dedup and terminal precedence | `test/tool-call.test.ts`, `test/tool-input-lifecycle.test.ts`, `test/reducer.test.ts` |
| Shell/spinner identity, placement, manual disclosure, explicit reset and independent multi-tool inspection | `test/native-view.test.ts`; audit adds same-ID isolation across two mounted views and reasoning update/completion/empty-removal identity/focus coverage |
| Tool preview inventory, no summary tooltips, accessible status, raw input and live-output inspection | `test/tool-card.test.ts`; audit adds raw-input disclosure/keyed section retention across distinct/identical final output and literal unknown-tool output without source truncation |
| Reasoning omission, first-line preview and preserved indicator/disclosure | `test/reasoning-card.test.ts`; native-view fixture addition covers the integrated patch path (not native platform acceptance) |
| Qualification, manual precedence, callback-before-growth and completion behavior | `test/tool-disclosure.test.ts`; real native timing remains acceptance work |
| Processing/interruption phases and parallel overview | `test/tool-progress.test.ts`; renderer extraction still needs registry/update/disposal and stable-member tests |
| Follow, reader cancellation, fractional settlement, resize and hidden state | `test/transcript-scroll.test.ts`; existing offline WebKit demo/workspace/steering/sidebar tests cover geometry/focus. Not run for this documentation/test-only audit; run browser suite when extraction changes scrolling/layout. |
| Unsupported renderer, mount/update/dispose throw, missing/incompatible renderer and historical raw fallback | No contract or tests yet; mandatory milestone-2 coverage for card-local recovery, stable sibling identity and retained data |

### Milestone-2 implementation order

1. Separate shell/disclosure/status/output-policy helpers from tool-specific presentation without changing exports/behavior unnecessarily. Keep Pi lifecycle reduction and transcript projection untouched.
2. Derive a small internal renderer instance contract from the existing default presentation: controlled content slots, incremental updates and explicit disposal. Core holds shell/status/raw recovery and the host-owned output viewport; renderer receives data and only explicitly needed presentation helpers. Exact signatures remain provisional.
3. Route creation, registry updates and both `patchMessage` branches through that owner. Add card-local fallback/cleanup for unsupported content and mount/update failures; dispose instances on removal/reset/view disposal. Fallback consumes retained tool data, not just message content.
4. Run the existing identity/disclosure/scroll suites through the boundary and add fault-injection, sibling isolation and cleanup tests. Run `mise run check` and offline browser tests for any layout/scroll changes. No external loader or richer card in this milestone.

## Invariants to preserve

- One tool card per invocation ID; placement changes reuse its mounted shell. Preserve connected disclosure/indicator nodes and independently inspected output positions.
- Generation, execution output, completion and result processing remain distinct. Late earlier-phase events must not rewind final state.
- Core retains closed-by-default behavior, sustained-update auto-open timing, manual-choice precedence and existing output caps. Plugins do not duplicate those policies.
- Streaming, renderer errors and content resizing must preserve transcript/output auto-follow intent, older-history reading position, modal focus and hidden-session state.
- Preserve raw inputs/results, accessible status labels, safe content rendering and existing tooltip-free summaries. Rendering never acknowledges or replays a prompt.
- Keep lifecycle/data interpretation Pi-specific where required. Do not modify upstream Pi or the sibling pi-gui extension as part of extraction.
- Shared card behavior must remain portable: macOS first, Linux next, Windows possible later. A passing DOM test is not native/platform acceptance.

## Incremental implementation plan

Milestone 1 is complete; milestones 2–5 remain pending. Treat each as independently mergeable work in a dedicated task worktree. Dependencies are sequential unless noted; external loading must not gate bundled extraction.

| Milestone | Dependency | Acceptance criteria |
| --- | --- | --- |
| 1. Audit current rendering boundaries — complete | None | Boundary map, concrete renderer inventory, data/recovery limitations, regression additions and next extraction order recorded above. No runtime extraction or native/plugin acceptance. |
| 2. Introduce the internal renderer contract | 1 | Existing tool cards render through the boundary without visible behavior changes. Core still owns the shell and policies; unsupported content and renderer failure have tested raw fallback behavior. |
| 3. Extract bundled renderers | 2 | Default tool-card presentations use the supported contract without privileged access. Record the concrete built-in inventory and reasoning-card scope; remaining default card renderers must be tracked explicitly, not silently exempted. |
| 4. Prove extensibility with a richer renderer | 3 | Choose a concrete card with available structured fixture data. Implement it using only the contract and host-supported capabilities, without tool-specific presentation branches in core. Refine the API from evidence. |
| 5. Support external plugins | 4 | Resolve packaging, compatibility, isolation, matching/overrides and action permissions before loading external code. Test missing/incompatible/failing plugins and historical fallback; document actual installation and selection behavior. |

Custom Pi-produced content is a separate follow-on track: resolve transport and history semantics before committing implementation milestones. It is not a prerequisite for alternative renderers of existing tool calls.

For each milestone, update this reference with changes, remaining questions and actual verification, and update the public guide with what has shipped. Retain the planned label while the feature remains unavailable; distinguish shipped subsets from remaining work afterward.

## Verification

The boundary audit and baseline regression additions are complete. No renderer-contract implementation, external loading or native/plugin acceptance has been established.

- `mise run check` passes: offline documentation checks (53 Markdown files), TypeScript checking and **457 Node/TypeScript tests**, Rust formatting/Clippy and **111 Rust tests** (two opt-in Pi smokes ignored).
- Four added regressions pass: distinct/final output and raw-input disclosure retention; literal unknown-tool data; integrated reasoning shell/indicator/disclosure/focus; invocation-ID isolation across separate mounted-view fixtures. The latter fixtures use separate jsdom documents, not native multi-window acceptance.
- `git diff --check` passes. No runtime/CSS changes, app build, app launch, live model requests or upstream Pi/extension changes. Browser tests were not run for this audit; native/platform verification remains unchanged.

Relevant existing regression suites include `test/tool-call.test.ts`, `test/tool-input-lifecycle.test.ts`, `test/native-view.test.ts`, `test/transcript-presentation.test.ts`, `test/tool-card.test.ts` and `test/reasoning-card.test.ts`. Add contract and fallback tests as the boundary is implemented.

Implementation requires `mise run check`; scrolling changes also require the offline `npm run test:browser` suite. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow). Keep tests fixture-based, with no paid requests or live session mutation. Request user validation for packaged-app visual behavior; record per-platform verification separately.
