# Harness presentation boundaries

**Status: implemented and offline-validated; real-agent and native app acceptance pending.** This is the current internal boundary and its rationale, not a public harness SDK. [ACP](acp-harnesses.md) owns protocol/lifecycle scope; [card plugins](card-plugins.md#multi-harness-plugin-boundary) owns the public content API; [verification](verification.md) owns evidence.

## Target portfolio and scope

**This is intended product scope, not a claim of implemented support or agent/platform acceptance.** Nimrod remains one shared workspace with a small curated set of first-class integrations, not a separate app per harness or a universal compatibility commitment.

| Integration | Target experience | Commitment |
| --- | --- | --- |
| Pi | Excellent | Flagship, bespoke integration that preserves Pi's distinctive supported capabilities and extension ecosystem. |
| Copilot | Great | Official SDK 1.0.22 with explicit installed CLI; implementation/fixtures authored, acceptance pending. |
| Codex | Great | Deliberate workflows, controls and presentation through supported interfaces. |
| Claude Code | Great | Deliberate workflows, controls and presentation through supported interfaces. |
| Other ACP agents | Good | Reliable capability-driven baseline, useful generic cards and optional presentation enhancements, without agent-specific completeness promises. |

These tiers distinguish richness and polish, **not correctness**. Every integration must preserve accurate sending/cancellation, permission handling, output, session isolation and process ownership. Generic ACP is not permission to weaken those guarantees.

Scope rules:

- Expose supported harness capabilities when they improve the Nimrod experience; preserve their actual semantics. Shared controls are appropriate where those semantics align, not as an obligation to maintain feature parity.
- Use supported ACP, SDK or native interfaces where practical. If a capability cannot be accessed readily through a supported interface, omit it. Do not reverse-engineer private behavior, emulate inaccessible capabilities, or pursue completeness with every CLI feature and extension.
- Harness identity and integration mechanism are distinct. Curated integrations use the best supported bespoke interface: Pi native and [Copilot SDK](copilot-sdk.md). Generic ACP remains separate. SDK use reuses the workspace and consumer ports; it does not imply transport switching or identity/draft interoperability.
- Card plugins enhance content presentation. Nimrod's concrete integrations remain responsible for lifecycle, permissions, configuration and overall correctness; external plugins are not expected to assemble the core harness experience.
- The named curated portfolio is bounded. Generic ACP compatibility does not make every agent a first-class maintenance commitment.
- Implement sequentially. Pi remains the flagship and Copilot the immediate second-integration target. Establish value and actual interoperability before further abstraction; no implementation order or delivery promise is set for Codex versus Claude Code.

## Decision and rationale

Share UI mechanics, not harness semantics. [Consumer-oriented interfaces](consumer-interfaces.md) extends this principle to shell boundaries, with a candidate inventory and definition checklist; it owns the precise `SessionPersistence`/`SessionConnectivity` lifecycle contracts and remaining extraction work. ACP supplies a reusable integration alongside native Pi, not the mandatory internal language of every session. A bespoke feel requires both faithful integration behavior and deliberate presentation; rendering plugins cannot reconstruct history, configuration, permissions or tool detail lost in an adapter.

The initial POC aliased `mountPiView` and introduced `ViewHost.acp` branches. It also made ACP construct empty Pi queues/extensions and Pi model controls. That proved reuse, but would make each new integration another set of conditions in the shared renderer. The review extracts only boundaries exercised by Pi and ACP rather than inventing a generic controller or public app-extension framework.

### Two different extension surfaces

| Surface | Owner and supported scope |
| --- | --- |
| Card content plugins | Public, trusted API v2: immutable tool data, mounted summary/body DOM, presentation helpers and Copy/link/Pop-out actions. No supported prompt/configuration/permission/transport execution. |
| Harness UI contributions | Internal trusted integration code: submission policy, advertised commands, configuration-control descriptors, status/information/metrics, user-content interpretation and session-action availability. Operations stay bound to the concrete session and its own controller. |
| Shared view | Mounted identity, incremental reconciliation, local Send feedback, disclosure, reading/focus intent, control DOM and cleanup. It does not decide what an ACP mode means or translate Pi steering into ACP operations. |
| Project shell | Windows, navigation, notices, palette/shortcut dispatch and native effects. It assembles concrete integrations; it does not expose those effects to card plugins. |

ACP is a broad fallback, not a ceiling or universal harness protocol. Copilot uses its own SDK backend. History, decisions and lifecycle project directly to existing consumer ports; the former Copilot ACP integration is removed and generic ACP adapters remain dormant, with no current product entry points. SDK fixtures/native acceptance remain pending; older extraction pass results do not cover the migration.

## Code map and contracts

- `src/conversation-model.ts`: shared canonical transcript records. Native tool identity, category, title and immutable metadata are distinct; unavailable fields remain unavailable.
- `src/conversation-view-host.ts`: internal presentation snapshots, interaction policy and view messages. `ConversationViewState.statusArea` consumes the narrow `StatusAreaSnapshot` interface in `src/status-area.ts`; see [Status-area interface](#status-area-interface). These are in-process presentation inputs, not a new harness wire protocol. Queue presentation is optional and supplied only by an integration with real queue semantics.
- `src/conversation-view.ts`: the actual shared mounted engine, moved from the Pi entry without changing its scroll/disclosure/hidden-catch-up owners. Legacy pure rendering helpers still live under `src/pi/`; relocating all helpers is not a prerequisite or a semantic abstraction.
- `src/pi/view-policy.ts`: Pi-only slash interception, steering/follow-up keyboard mapping, compaction hints, skill disclosures, palette actions and conversation projection. `src/pi/status-area.ts` separately owns Pi configuration/extensions/usage presentation. `createPiViewProjection` preserves lazy transcript access and reference-stable Status-area/queue projections on content-only updates. Never spread/materialize `TranscriptUpdates`' lazy messages when projecting UI.
- `src/pi/webview-client.ts` / `view-host.ts` / `view-state.ts`: compatibility entry for Pi callers and existing fixtures. Pi controller/reducer state and RPC behavior remain unchanged. Control IDs translate to existing Pi operations at the adapter boundary.
- `src/acp/view-policy.ts`: advertised-only slash completion, busy-send rejection through the owning session, no steering/queues, text-only attachment guidance and agent-specific Stop label. ACP does not interpret Pi skill markup.
- `src/acp/session.ts`: produces display state directly, without fabricated Pi queue, extension or model-control records. Agent-advertised model/thinking/**mode** categories contribute keyed Status-area controls; remaining or uncategorized options remain in the palette. Values/descriptions come from the agent; a mode label does not imply a client-invented permission policy.
- `src/session-backend.ts`: discriminated Pi/SDK/ACP ownership with one optional concrete controller. Session actions come from the selected integration. `main.ts` captures their owning conversation for palette execution, revalidates availability, and shares the dispatcher with shortcuts. `SessionLifecycle` (`src/session-lifecycle.ts`, concrete implementations under `pi/`, `copilot/` and `acp/`) composes `SessionPersistence` and `SessionConnectivity`: saved identity/key/draft scope, connection state/eligibility, connect, owned stop and disconnect. Restart capability never decides sidebar persistence. [Session history](session-history.md) owns the shared list/status and discovery ports; Resume selects through native file/exact-ID loading. Restart remains Pi-specific; deletion has concrete Pi and Copilot SDK implementations.

Control updates preserve existing button nodes by ID, hide unsupported controls/separators, and do not navigate or focus. New controls use the same Status-area layout. Connected configuration controls accept immediate or deferred intent, including replacements during a mutation. Pi can apply during work/compaction; Copilot model/effort/mode/context and dormant ACP apply at their supported idle boundary. Copilot's [live permission configuration](live-permissions.md) is a separate owner and uses advertised live-command readiness, without another renderer or backend-specific picker. [Model/thinking](model-thinking.md) owns the shared configuration port, readiness, dependencies and local transcript progress.

Local draft clearing, previews, Send recency/follow effects, uncertain-delivery handling and no replay remain governed by [composer](composer.md) and [architecture](architecture.md#optimistic-interaction-policy). Policies classify intent before draft clearing; the shared view performs local effects, and later results never repeat them.

## Status-area interface

**Status: source-implemented; new/updated fixtures unrun.** This extraction preserves current visible behavior and layout; it does not establish SDK/native acceptance or add harness parity.

The Status area consumes `StatusAreaSnapshot` (`src/status-area.ts`) through `ConversationViewState.statusArea`, not concrete harness state. It contains:

- `capabilities`: optional metrics support with the integration's accessible label, and optional information/subagent/queue surfaces. Omitted/false means unsupported. Reported zero remains distinct from unknown. Concrete adapters may supply documented display-only seeds (see [Copilot usage](copilot-sdk.md#usage-metrics)); they must not turn those seeds into authoritative usage measurements, and tooltip detail must retain provenance. The renderer gates surfaces on capabilities even if a producer retains older data.
- `controlsLabel` and keyed `controls`: control descriptors are themselves the support inventory, avoiding parallel model/thinking flags. Absent controls are unsupported; `disabled` controls are supported but temporarily unavailable. Values/titles remain integration-owned, without a universal model/effort enum.
- Optional reported `metrics`, `information` and `subagents`: integration-owned presentation values, never invented costs, queues or child activity. Optional `metricsTitle` supplies exact metric detail/units for native tooltip and accessibility; its changes independently invalidate the metrics section. Copilot's documented USD conversion is owned by [SDK usage metrics](copilot-sdk.md#usage-metrics), not the shared renderer.

Concrete mappings:

| Producer | Controls / availability | Optional surfaces |
| --- | --- | --- |
| `src/pi/status-area.ts::createPiStatusArea` | Confirmed model/thinking; startup/unavailability disable requests. Work, compaction and an in-flight change do not prevent choosing replacement intent. | Pi-formatted cost/context/auto-compaction estimates, extension information/widgets, recognized subagent counts and real Pi queue. |
| `src/copilot/status-area.ts::createCopilotStatusArea` | Catalog-supported model, selected-model-supported effort and authoritative session mode, rendered as `model · effort · mode`; the SDK session separates connected request availability from idle-only application. Pending configuration is shown only in the transcript, never in this snapshot. New sessions honor non-null SDK-reported Copilot preferences at creation (see [SDK initialization](copilot-sdk.md#send-events-controls-and-decisions)); Resume never inherits them. Unknown values independently display lowercase `default model` / `default effort`, with unresolved-model effort disabled rather than guessed. Native reported values supersede creation inputs. | Root context utilization plus SDK aggregate AI-credit totals/estimated USD, with exact AIC/context and coverage in `metricsTitle`. The reported context limit carries the session’s context-window action when supported. No invented costs, Auto compact, queues, extension or subagent rows. |
| Dormant `src/acp/session.ts` | Existing advertised configuration descriptors and concrete gates, mechanically migrated to the same snapshot. | Existing context/plan information; no new product entry points. |

Each projection is constructed per owning session/view. Publications remain synchronous and ordered on the existing conversation channel; no second event bus, subscription lifetime, controller or persistence is introduced. Producers retain the entire snapshot and child arrays on content-only updates, and rebuild only changed contributions. Pi's projector accepts only Status-area inputs and never reads transcript history. Capability changes must invalidate their affected surfaces, including hidden-session catch-up.

Main activity (`busy`/`status`), connection availability and the composer-owned queue/recovery remain on their existing conversation state. The Status area reads real queue presentation only when supported; local recovered messages remain available independently of harness queue support. No queue semantics move into the generic interface.

Actions still dispatch opaque control IDs through the originating mounted view's session-bound `selectControl` path. Concrete session pickers retain their existing validation, authoritative configuration reconciliation and error handling. Snapshot publication/receipt is not an async operation acknowledgement and authorizes no prompt, navigation, focus, draft mutation or replay. Control nodes remain keyed and retained across disabling/removal/reappearance; layout and scroll owners are unchanged.

`metricParts` is the structured form of the otherwise integration-formatted
metrics string. Plain parts remain text; a part carrying an action ID renders as
a compact button and dispatches through the same originating-session action
path. Copilot uses this only for its reported context limit. Pi retains a plain
context-limit string because it contributes no context-window action.

Authored fixtures: `test/status-area.test.ts` covers both concrete mappings, reference stability, capability/availability distinctions and unknown versus zero metrics. `test/conversation-view.test.ts` covers lazy history, keyed controls, surface gating and capability revocation during hidden catch-up. `test/copilot-sdk.test.ts` covers real controller publications, root/child usage, model-specific effort removal, idle/busy and disconnect. Dormant ACP fixtures use the new snapshot location. **None of these changes have been tested, checked, built or accepted natively.**

The Status-area snapshot extraction introduced no storage/wire/public-plugin change. The subsequent [SessionConfiguration](model-thinking.md#consumer-interface) implementation adds deferred configuration and local transcript progress; its user-visible behavior is documented separately. The shell retains composition/session-bound routing; concrete integrations retain mutation/lifecycle semantics.

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
- Full `mise run test` and `npm run test:browser` passed for the extraction baseline: **798 TS/Node tests, 154 Rust tests (2 installed-Pi smokes ignored), TypeScript checking, 82-document links/anchors, formatting/Clippy and 123 offline WebKit tests**. The new projection fixture was corrected to preserve Pi's exact reported subagent label; production behavior was unchanged. The browser plugin disclosure/local-input scenario failed intermittently once, then passed three focused repetitions and the complete rerun without a test or production workaround; [verification](verification.md#current-automated-validation) retains that caveat. Real Copilot and a second ACP agent, native Tauri focus/permissions/pipe behavior, macOS visuals and Linux acceptance remain outstanding. Only perform requested validation; scrolling validation includes offline WebKit.
