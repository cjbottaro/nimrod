# Architecture

**Status: current system boundaries.** Read before changes alongside repository `AGENTS.md`. Feature-specific specifications live in the linked references, not here.

## Product boundary

Nimrod is a directory-backed agent workspace, not an IDE or generic chat frontend. One canonical directory belongs to each project window and is every session's exact cwd. Nested worktrees with other cwd values require separate windows. User terminology is Project/Project bar; existing workspace identifiers, IPC labels and storage keys remain compatibility details.

Pi is primary; curated integrations are bespoke-first: Pi native RPC and the pinned official [Copilot SDK](copilot-sdk.md). [Generic ACP](acp-harnesses.md) is retained internal protocol/adapter infrastructure, without product creation/options actions or restored ACP sidebar sessions. Copilot-specific ACP persistence/history/deletion are removed; old stored drafts are not migrated or deleted. SDK fixtures/packaging/native acceptance are pending. Session backends are immutable: SDK events project directly to shared consumer presentation, never fabricated ACP/Pi events. Harnesses own conversation history, tools, models, configuration and semantic lifecycle; Nimrod owns presentation, local drafts, native windows, process ownership and explicit supported deletion.

## Responsibility map

| Layer | Responsibility | Canonical specification |
| --- | --- | --- |
| Project shell (`src/main.ts`) | Mounted session views and effect coordination | [Projects/sessions](projects-and-sessions.md) |
| Navigation/connection | Shared projections, activation and connection deferral | [Session navigation](session-navigation.md) |
| Session lists/history | Shared semantic list/status projection and project-bound discovery, separate from connection owners | [Session history](session-history.md) |
| Session deletion | Registered target-bound operations through one shared UI/effects coordinator; native Pi tree transactions, capability-gated Copilot single-session deletion and guarded Codex spawned-tree deletion | [Session deletion](session-deletion.md) |
| Pi coordinator/transport | Ordered RPC, identity and result correlation | [Pi transport](pi-transport.md) |
| Experimental ACP integration | Separate native ownership/JSON-RPC/session semantics; shared presentation, not Pi events | [ACP POC](acp-harnesses.md) |
| Shared view / harness UI contributions | Presentation mechanics with integration-owned interaction policies, controls and actions | [Harness presentation and rationale](harness-presentation.md) |
| Transcript/composer | Incremental presentation and user intent | [Cards](transcript-cards.md), [scroll/focus](transcript-interaction.md), [composer](composer.md) |
| Rust host | Window/token ownership, pipes, shutdown and file validation | [Projects/sessions](projects-and-sessions.md), [Pi transport](pi-transport.md) |
| Settings/state | JSONC preferences and separate app-managed bookkeeping | [Preferences](preferences.md) |
| Window presentation | Shared creation/focus composition, explicit theme snapshots, appearance pipeline and prepared-window lifetime | [Window presentation](window-presentation.md) |
| Native integrations | Startup, references and notifications | [Startup](single-instance.md), [pop-outs](pop-outs.md), [notifications](notifications.md) |

The shared mounted engine consumes presentation records and integration-owned interaction/control/status contributions. It has no Pi/ACP mode switch. Card plugins remain presentation-only; concrete session controllers retain semantic authority. `SessionBackend` is a tagged Pi/Copilot/Codex/ACP controller alternative. Separately, `SessionLifecycle` composes the Nimrod-owned `SessionPersistence` and `SessionConnectivity` interfaces implemented by Pi, Copilot, Codex and ACP adapters: saved identity, stable project-local key/draft scope, connection state/eligibility, connect, owned stop and transport disconnect. Open/closed membership stays in navigation, independent of connectivity and Restart capability. This is not a common wire/conversation protocol. [Harness presentation](harness-presentation.md) records this boundary, its rationale and regression requirements.

The [Codex integration](../../codex-integration/SKILL.md) uses native app-server stdio with its own process/thread semantics and the same consumer-facing view, message-input, lifecycle, configuration and history ports. Ordered RPC mechanics are shared with ACP; scoped process-group exit observation is shared with Copilot, not their handshakes or controllers. Codex native acceptance remains pending.

Shared consumers depend on small interfaces for their needs, not concrete backend state; composition and persistence decoding may retain tagged unions. [Consumer-oriented interfaces](consumer-interfaces.md) owns the extraction rules, lifecycle guarantees and candidate inventory. Pi-specific file metadata and startup sequencing remain under `src/pi/`. Concrete launch orchestration is still partially shell-owned; this is an incremental direction, not a completed universal integration framework.

There is no extra Node backend; Pi itself requires Node. The reducer and request correlation remain TypeScript so response snapshots apply synchronously in the ordered channel before later events. Rust validates the outer framing/record, TypeScript validates relevant Pi payload content. Small TS/Rust launch/packet shapes are hand-maintained; Pi's open-ended payload remains JSON.

## Optimistic interaction policy

User intent drives local UI immediately after local validation; do not make RPC acknowledgement a general prerequisite for interaction feedback. Dispatch work without waiting for prior prompt results. For Send, clear the composer, preview the message (images after local byte preparation), update session recency and follow the current recency-ordered sidebar row to the top. Image preparation must not delay recency or sidebar feedback.

RPC results correlate errors to the originating operation and supply specific authoritative results; successful replies do not repeat local interaction effects. Harness events/history reconcile optimistic presentation in place. Late failures or uncertainty annotate the affected message and report its error without restoring the composer, rolling back Send recency, reordering/selecting sessions again, changing a newer draft or automatically replaying work. No persisted submission lifecycle or acceptance-driven UI gate.

Pi remains authoritative for history, queue consumption, configuration, identity and process state. Narrow result-dependent behavior (for example, a confirmed Queued label, canonical identity verification, operation-in-flight lifecycle guards or destructive-operation completion) must have a documented concrete requirement; it is not precedent for delaying ordinary user feedback. Preserve focus. Preserve transcript reader/follow intent except for Send's explicit [auto-follow preference](transcript-interaction.md#auto-follow-after-sending). Its transcript navigation is local-only, never repeated by results or image preparation. Send's sidebar-to-top effect is not permission to switch filters.

## Cross-cutting contracts

- One ordered channel carries all stdout events and responses. Synchronous snapshot application is required; Promise continuations alone can overwrite newer streaming state.
- Apply the [optimistic interaction policy](#optimistic-interaction-policy). Unknown delivery is not rejection; never replay a prompt. RPC results never mutate a newer draft or repeat Send's navigation effects.
- Native ownership is window/token scoped. Shutdown must observe owned-child exit before replacement launch; failed shutdown retains reservations. No OS-wide process scans or external-writer exclusion guarantee.
- Shared navigation decides membership/order/replacement; the shell owns DOM, focus, persistence and native effects. All activations request connection through the single connection coordinator.
- Pending agent decisions that support presentation-only dismissal follow the [dismiss-and-resume workflow](dismiss-and-resume.md): users can inspect the Transcript and reopen the decision from its session-local pending-action banner without answering or cancelling it.
- Routine updates preserve mounted nodes, disclosures, focus and scroll intent. Explicit resume/restart is a distinct reset boundary.
- Nimrod-generated errors without an owning [operation card](operation-cards.md) share one notice store/renderer, with ownership-based placement: session notices stay in their conversation area; window/application notices use the shell strip, including Settings/dialogs. Background-session errors are not displayed or announced elsewhere. Placement, wording, deduplication and lifecycle follow the [error presentation policy](error-presentation.md); remaining producer metadata cleanup is not precedent for new surfaces.
- Preferences and bookkeeping are separate from Pi history and scoped draft storage.
- Harness commands remain harness-owned even when a Nimrod action overlaps:
  use generic advertised command plumbing first, then the narrowest concrete
  adapter for interface gaps; never substitute an application action for slash
  command execution. See [harness command ownership](harness-presentation.md#harness-command-ownership).
- RPC results and background delivery/completion never navigate themselves. Explicit user navigation can connect a saved session without sending a prompt.
- Platform direction is macOS first, Linux next, Windows possibly later. Narrow native integrations must not turn macOS conventions into portable product requirements. See [verification](verification.md) for actual acceptance.

## Window presentation choke points

[Window presentation](window-presentation.md) owns change routing and implementation boundaries. Every native constructor composes appearance and navigation through `window_presentation::prepare`; navigation security does not own styling. Explicit user focus is centralized separately from passive reference restoration. `applyTheme` publishes a completed, root-local appearance snapshot instead of having native presentation infer palette changes from DOM mutations. A single typed native pipeline serializes appearance/title work; a prepared-window lifetime owner handles first reveal/cancellation/cleanup. Feature owners retain their concrete project/session/Settings identity and lifecycle—this is not a generic harness abstraction or a single catch-all UI controller.

## Source provenance

Transcript/reducer/composer modules and baseline tests originated in the user's local sibling `pi-gui`, including uncommitted interaction fixes, without changing that project. The VS Code host was not copied. Nimrod owns its bridge, Pi coordinator, Rust backend, packaging and policies. `scripts/bootstrap-ui.mjs` records the one-time extraction; never rerun it as a build step or overwrite subsequent work.

## Documentation ownership

Use one owner per fact, not a feature summary copied into every related document:

- [Features index](../SKILL.md) routes work with short labels/links, not specifications or validation status.
- Each feature reference owns its current contract, invariants, storage/schema, code map and fixture locations. Shared contracts have one reference; consumers link to the relevant heading and document only their integration-specific differences.
- [User guides](../../../../docs/README.md) own usage, observable behavior and relevant limitations. Keep implementation symbols, fixture inventories and run histories out. Some user-visible facts necessarily appear in both audiences; do not copy whole internal sections.
- [Verification](verification.md) owns executed evidence and current acceptance gaps. Feature references link there instead of repeating pass counts, failed runs or acceptance matrices. Significant superseded investigations/results go in `references/history/`, clearly historical.
- [Contributing](../../../../CONTRIBUTING.md) owns developer setup/tooling. README and guide indexes provide discovery links. The [changelog](../../../../CHANGELOG.md) summarizes meaningful user-visible changes, not implementation contracts or an activity log.
- Behavior changes update the canonical internal reference and relevant user guide; implementation-only changes update internal references. Add new references to the feature index and new user guides to both docs/README and the main README.

Before adding a paragraph, locate its owner. Update that owner and replace dependent copies with links; do not append another summary to every related page. Renaming a feature includes private symbols, files, IPC, DOM IDs, tests and links; retain old names only at actual persisted/external compatibility boundaries or in clearly historical records.
