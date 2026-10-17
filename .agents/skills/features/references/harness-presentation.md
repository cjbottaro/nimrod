# Harness presentation boundaries

**Status: implemented and offline-validated; real-agent and native app acceptance pending.** This is the current internal boundary and its rationale, not a public harness SDK. [ACP](acp-harnesses.md) owns protocol/lifecycle scope; [card plugins](card-plugins.md#multi-harness-plugin-boundary) owns the public content API; [verification](verification.md) owns evidence.

## Target portfolio and scope

**This is intended product scope, not a claim of implemented support or agent/platform acceptance.** Nimrod remains one shared workspace with a small curated set of first-class integrations, not a separate app per harness or a universal compatibility commitment.

| Integration | Target experience | Commitment |
| --- | --- | --- |
| Pi | Excellent | Flagship, bespoke integration that preserves Pi's distinctive supported capabilities and extension ecosystem. |
| Copilot | Great | Deliberate workflows, controls and presentation through supported interfaces. |
| Codex | Great | Deliberate workflows, controls and presentation through supported interfaces. |
| Claude Code | Great | Deliberate workflows, controls and presentation through supported interfaces. |
| Other ACP agents | Good | Reliable capability-driven baseline, useful generic cards and optional presentation enhancements, without agent-specific completeness promises. |

These tiers distinguish richness and polish, **not correctness**. Every integration must preserve accurate sending/cancellation, permission handling, output, session isolation and process ownership. Generic ACP is not permission to weaken those guarantees.

Scope rules:

- Expose supported harness capabilities when they improve the Nimrod experience; preserve their actual semantics. Shared controls are appropriate where those semantics align, not as an obligation to maintain feature parity.
- Use supported ACP, SDK or native interfaces where practical. If a capability cannot be accessed readily through a supported interface, omit it. Do not reverse-engineer private behavior, emulate inaccessible capabilities, or pursue completeness with every CLI feature and extension.
- Harness identity and integration mechanism are distinct. A curated Copilot experience can use the shared ACP client plus specific UI contributions; it does not need a separate transport to be bespoke. SDK use does not require another workspace implementation or imply seamless switching of an existing session's backend.
- Card plugins enhance content presentation. Nimrod's concrete integrations remain responsible for lifecycle, permissions, configuration and overall correctness; external plugins are not expected to assemble the core harness experience.
- The named curated portfolio is bounded. Generic ACP compatibility does not make every agent a first-class maintenance commitment.
- Implement sequentially. Pi remains the flagship and Copilot the immediate second-integration target. Establish value and actual interoperability before further abstraction; no implementation order or delivery promise is set for Codex versus Claude Code.

## Decision and rationale

Share UI mechanics, not harness semantics. ACP supplies a reusable integration alongside native Pi, not the mandatory internal language of every session. A bespoke feel requires both faithful integration behavior and deliberate presentation; rendering plugins cannot reconstruct history, configuration, permissions or tool detail lost in an adapter.

The initial POC aliased `mountPiView` and introduced `ViewHost.acp` branches. It also made ACP construct empty Pi queues/extensions and Pi model controls. That proved reuse, but would make each new integration another set of conditions in the shared renderer. The review extracts only boundaries exercised by Pi and ACP rather than inventing a generic controller or public app-extension framework.

### Two different extension surfaces

| Surface | Owner and supported scope |
| --- | --- |
| Card content plugins | Public, trusted API v2: immutable tool data, mounted summary/body DOM, presentation helpers and Copy/link/Pop-out actions. No supported prompt/configuration/permission/transport execution. |
| Harness UI contributions | Internal trusted integration code: submission policy, advertised commands, configuration-control descriptors, status/information/metrics, user-content interpretation and session-action availability. Operations stay bound to the concrete session and its own controller. |
| Shared view | Mounted identity, incremental reconciliation, local Send feedback, disclosure, reading/focus intent, control DOM and cleanup. It does not decide what an ACP mode means or translate Pi steering into ACP operations. |
| Project shell | Windows, navigation, notices, palette/shortcut dispatch and native effects. It assembles concrete integrations; it does not expose those effects to card plugins. |

ACP is a broad path, not a ceiling. Agent-specific presentation is the default first approach, but a supported SDK/native backend is appropriate when concrete capability gaps justify it. Such a backend is an alternative controller, never a concurrent second owner of a live session. No SDK, history migration, persistent ACP identity or real-agent compatibility is claimed by this extraction.

## Code map and contracts

- `src/conversation-model.ts`: shared canonical transcript records. Native tool identity, category, title and immutable metadata are distinct; unavailable fields remain unavailable.
- `src/conversation-view-host.ts`: internal presentation snapshots, interaction policy, keyed controls and view messages. These are in-process presentation inputs, not a new harness wire protocol. Queue presentation is optional and supplied only by an integration with real queue semantics.
- `src/conversation-view.ts`: the actual shared mounted engine, moved from the Pi entry without changing its scroll/disclosure/hidden-catch-up owners. Legacy pure rendering helpers still live under `src/pi/`; relocating all helpers is not a prerequisite or a semantic abstraction.
- `src/pi/view-policy.ts`: Pi-only slash interception, steering/follow-up keyboard mapping, compaction hints, skill disclosures, palette actions and projection of Pi configuration/extensions/usage. `createPiViewProjection` preserves lazy transcript access and reference-stable controls/information/queue projections on content-only updates. Never spread/materialize `TranscriptUpdates`' lazy messages when projecting UI.
- `src/pi/webview-client.ts` / `view-host.ts` / `view-state.ts`: compatibility entry for Pi callers and existing fixtures. Pi controller/reducer state and RPC behavior remain unchanged. Control IDs translate to existing Pi operations at the adapter boundary.
- `src/acp/view-policy.ts`: advertised-only slash completion, busy-send rejection through the owning session, no steering/queues, text-only attachment guidance and agent-specific Stop label. ACP does not interpret Pi skill markup.
- `src/acp/session.ts`: produces display state directly, without fabricated Pi queue, extension or model-control records. Agent-advertised model/thinking/**mode** categories contribute keyed Status-area controls; remaining or uncategorized options remain in the palette. Values/descriptions come from the agent; a mode label does not imply a client-invented permission policy.
- `src/session-backend.ts`: discriminated Pi-or-ACP ownership with one optional concrete controller, not two independent controller slots. Session actions come from the selected integration. `main.ts` captures their owning tab for palette execution, revalidates availability, and shares the dispatcher with shortcuts. Resume/restart/delete retain explicit Pi-specific implementations.

Control updates preserve existing button nodes by ID, hide unavailable controls/separators, and do not navigate or focus. New controls use the same Status-area layout. Pi controls remain available during work/compaction under Pi's existing policy; ACP controls are disabled while a turn or configuration request is active. These are separate state reasons, recomputed at turn/configuration transitions.

Local draft clearing, previews, Send recency/follow effects, uncertain-delivery handling and no replay remain governed by [composer](composer.md) and [architecture](architecture.md#optimistic-interaction-policy). Policies classify intent before draft clearing; the shared view performs local effects, and later results never repeat them.

## Fidelity and transport fixes accompanying the boundary

- ACP tool updates and permission requests share one retained tool-state owner. `src/acp/tool-state.ts::patchTool` treats optional null/omitted fields as unchanged, while preserving nested JSON nulls in actual arguments. An ID-only permission request resolves the retained title/inputs/content/locations; a supplied permission patch also updates the transcript synchronously in receive order before later notifications. Waiting for the choice does not defer state processing or replay the patch; the pending decision retains its own immutable details. Permission details are literal, show the call ID, and remain outside card-plugin authority. Choices/cancellation are still correlated by the ACP client to the exact request and turn.
- Non-text content blocks are separate sequence entries, not replacements merely because content type/message ID repeats. Unsupported rich output uses literal JSON blocks and preserves every block; this is fallback, not support for rich attachment sending.
- `src-tauri/src/acp.rs` independently polls the ordered writer alongside stdout, stderr and Stop. It retains one pinned write future across select iterations, so partial writes are not restarted when a read wins. Dropping the writer scope closes stdin and retires unfinished requests before observing child exit. The five-second write deadline remains a bound on an unresponsive agent, not an accidental deadlock caused by suspending output reads.

See [ACP tool calls](https://agentclientprotocol.com/protocol/tool-calls) for optional patch/permission semantics. These fixes do not authorize live protocol probes.

## Regression guardrails and evidence

- Keep Pi protocol/reducer/model/queue controllers separate. The compatibility entry and new projection must continue to exercise the existing Pi fixtures, not replace them with narrower tests.
- Keep presentation publication ordered and synchronous; defer painting only. Preserve lazy full history, continuous dirty-row revisions, retained card/control identity and hidden-session catch-up. Do not add a second scroll owner or bind presentation controls to whichever session happens to be active when an async operation finishes.
- Plugin selection and lifecycle are separate: current enablement/trust guards apply before mount-time applicability, including while an asynchronous reload retains old entries. Applicability can try another candidate; compatibility/update failure after mounting retains existing raw-fallback behavior. The [plugin reference](card-plugins.md#multi-harness-plugin-boundary) owns precedence and the POC category-matching migration.
- Added `test/conversation-view.test.ts`: policies, lazy/stable Pi projection, concrete action availability, keyed generic controls and literal rich output/hidden catch-up. Extended ACP session/card fixtures cover partial permissions/null patches, multiple rich blocks, busy configuration updates and scoped candidate selection.
- Native fixtures cover simultaneous large input/output and Stop during blocked stdin. Offline browser fixtures now use ID-only permission requests, unsolicited configuration during work and an advertised mode selector. Existing Pi suites remain the regression base.
- Latest follow-up fixtures for suspended plugin revocation and synchronous permission-patch ordering are authored but unrun; the following gate results precede those fixes.
- Full `mise run check` and `npm run test:browser` passed for the extraction baseline: **798 TS/Node tests, 154 Rust tests (2 installed-Pi smokes ignored), TypeScript checking, 82-document links/anchors, formatting/Clippy and 123 offline WebKit tests**. The new projection fixture was corrected to preserve Pi's exact reported subagent label; production behavior was unchanged. The browser plugin disclosure/local-input scenario failed intermittently once, then passed three focused repetitions and the complete rerun without a test or production workaround; [verification](verification.md#current-automated-validation) retains that caveat. Real Copilot and a second ACP agent, native Tauri focus/permissions/pipe behavior, macOS visuals and Linux acceptance remain outstanding. Only perform requested validation; scrolling validation includes offline WebKit.
